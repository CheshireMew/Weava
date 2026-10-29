import Database from 'better-sqlite3';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { digest } from './storage.ts';
import { assertOffline } from './backup.ts';
import { normalizePath } from './site.ts';
import { referral } from './analytics-dimensions.ts';

const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = int.min(1),
  text = z.string().max(10000),
  optionalText = text.nullable();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '日期不存在',
  );
const datetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v.replace(' ', 'T') + 'Z')) &&
      new Date(v.replace(' ', 'T') + 'Z').toISOString().slice(0, 19) === v.replace(' ', 'T'),
    '时间无效',
  );
const visitor = z
  .object({
    id,
    day,
    browser: optionalText,
    os: optionalText,
    browserVersion: optionalText,
    device: optionalText,
    model: optionalText,
    country: optionalText,
    city: optionalText,
    region: optionalText,
    continent: optionalText,
    referrer: optionalText,
    sourceChannel: optionalText,
    sourceName: optionalText,
    hits: int.nullable(),
    firstPage: int.nullable(),
    firstView: datetime.nullable(),
    lastPage: int.nullable(),
    lastView: datetime.nullable(),
  })
  .strict();
const page = z.object({ id, uri: text, type: text, day, views: int, objectId: int }).strict();
const relationship = z.object({ id, visitorId: id, pageId: id, at: datetime }).strict();
const daily = z.object({ id, day, visitors: int, views: int }).strict();
const historical = z
  .object({ id, category: text, pageId: int.nullable(), uri: optionalText, value: int })
  .strict();
const event = z
  .object({ id, at: datetime, pageId: int.nullable(), visitorId: int.nullable(), name: text })
  .strict();
const table = <T extends z.ZodType>(row: T) =>
  z
    .object({
      present: z.boolean(),
      count: int,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      rows: z.array(row),
    })
    .strict();
const schema = z
  .object({
    schema: z.literal('weava-wp-statistics-v1'),
    source: z
      .object({ siteUrl: z.string().url(), timezone: z.string(), pluginVersion: optionalText })
      .strict(),
    capturedAt: z.string().datetime({ offset: true }),
    databaseReadOnly: z.literal(true),
    consistentSnapshot: z.literal(true),
    missingColumns: z.record(z.string(), z.array(z.string())),
    tables: z
      .object({
        visitors: table(visitor),
        pages: table(page),
        relationships: table(relationship),
        daily: table(daily),
        historical: table(historical),
        events: table(event),
      })
      .strict(),
  })
  .strict();
export type WordpressStatisticsSnapshot = z.infer<typeof schema>;
export type WordpressStatisticsTable = keyof WordpressStatisticsSnapshot['tables'];
const tableNames: WordpressStatisticsTable[] = [
  'visitors',
  'pages',
  'relationships',
  'daily',
  'historical',
  'events',
];
const maxBytes = 128 * 1024 * 1024;
function stable(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function sourceIdentity(siteUrl: string) {
  const url = new URL(siteUrl);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new WeavaError('WordPress 来源网址无效。');
  return url.origin + url.pathname.replace(/\/$/, '');
}
function validTimezone(zone: string) {
  if (/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone)) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date());
  } catch {
    throw new WeavaError('来源时区无效。');
  }
}
function unique(rows: { id: number }[], name: string) {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new WeavaError('来源表编号重复：' + name + '/' + row.id);
    seen.add(row.id);
  }
}
export function parseWordpressStatistics(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new WeavaError('WP Statistics 快照格式无效。', 400, parsed.error.issues.slice(0, 12));
  const snapshot = parsed.data;
  sourceIdentity(snapshot.source.siteUrl);
  validTimezone(snapshot.source.timezone);
  for (const name of tableNames) {
    const raw = (input as WordpressStatisticsSnapshot).tables[name],
      t = snapshot.tables[name];
    if (t.rows.length !== t.count || digest(JSON.stringify(raw.rows)) !== t.sha256)
      throw new WeavaError('来源表校验失败或传输不完整：' + name);
    if (!t.present && t.count) throw new WeavaError('不存在的来源表不能包含记录：' + name);
    unique(t.rows, name);
    t.sha256 = digest(JSON.stringify(t.rows));
  }
  for (const name of ['visitors', 'pages', 'relationships'] as const)
    if (!snapshot.tables[name].present) throw new WeavaError('缺少必要统计表：' + name);
  const visitors = new Set(snapshot.tables.visitors.rows.map((r) => r.id)),
    pages = new Set(snapshot.tables.pages.rows.map((r) => r.id));
  for (const relation of snapshot.tables.relationships.rows)
    if (!visitors.has(relation.visitorId) || !pages.has(relation.pageId))
      throw new WeavaError('访问关联缺少对应访客或页面：' + relation.id);
  const days = new Set<string>();
  for (const row of snapshot.tables.daily.rows) {
    if (days.has(row.day)) throw new WeavaError('每日汇总日期重复：' + row.day);
    days.add(row.day);
  }
  for (const row of snapshot.tables.visitors.rows)
    if (row.firstView && row.lastView && row.firstView > row.lastView)
      throw new WeavaError('访客首末时间顺序无效：' + row.id);
  return snapshot;
}
export function readWordpressStatistics(file: string) {
  if (statSync(file).size > maxBytes) throw new WeavaError('快照超过 128 MB，请按来源分批迁移。');
  const bytes = readFileSync(file);
  if (bytes.length > maxBytes) throw new WeavaError('快照超过 128 MB，请按来源分批迁移。');
  let input: any;
  try {
    input = JSON.parse(bytes.toString('utf8').replace(/^\ufeff/, ''));
  } catch {
    throw new WeavaError('快照不是完整的 JSON 文件。');
  }
  if (input && Object.hasOwn(input, 'exit_code')) {
    if (input.exit_code !== 0 || typeof input.stdout !== 'string')
      throw new WeavaError('服务器导出未成功，不能导入此响应。');
    try {
      input = JSON.parse(input.stdout.replace(/^\ufeff/, ''));
    } catch {
      throw new WeavaError('服务器返回的快照不完整。');
    }
  }
  return parseWordpressStatistics(input);
}
export function extractWordpressStatistics(input: string, output: string) {
  const snapshot = readWordpressStatistics(input),
    path = resolve(output);
  writeFileSync(path, JSON.stringify(snapshot), { flag: 'wx' });
  return { path, ...inspectWordpressStatistics(snapshot) };
}
function metadata(snapshot: WordpressStatisticsSnapshot) {
  const siteUrl = sourceIdentity(snapshot.source.siteUrl),
    sourceId = 'wp-statistics:' + digest(siteUrl).slice(0, 24);
  // Excludes transport checksums and capture time so unchanged exports are a no-op.
  const contentHash = digest(
    stable({
      source: { ...snapshot.source, siteUrl },
      missingColumns: snapshot.missingColumns,
      tables: Object.fromEntries(
        tableNames.map((name) => [
          name,
          {
            present: snapshot.tables[name].present,
            rows: [...snapshot.tables[name].rows].sort((a, b) => a.id - b.id),
          },
        ]),
      ),
    }),
  );
  const fingerprint = digest(stable(snapshot));
  return {
    sourceId,
    siteUrl,
    contentHash,
    fingerprint,
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}
export function inspectWordpressStatistics(snapshot: WordpressStatisticsSnapshot) {
  const { tables } = snapshot,
    dates = (rows: { day: string }[]) => {
      const sorted = rows.map((r) => r.day).sort();
      return { start: sorted[0] || null, end: sorted.at(-1) || null };
    };
  return {
    ...metadata(snapshot),
    source: snapshot.source,
    counts: Object.fromEntries(tableNames.map((name) => [name, tables[name].count])),
    ranges: {
      details: dates(tables.visitors.rows),
      daily: dates(tables.daily.rows),
      pages: dates(tables.pages.rows),
    },
    totals: {
      dailyViews: tables.daily.rows.reduce((n, r) => n + r.views, 0),
      dailyVisitors: tables.daily.rows.reduce((n, r) => n + r.visitors, 0),
      pageViews: tables.pages.rows.reduce((n, r) => n + r.views, 0),
      visitorHits: tables.visitors.rows.reduce((n, r) => n + (r.hits || 0), 0),
      historical: tables.historical.rows.reduce(
        (totals, r) => {
          totals[r.category] = (totals[r.category] || 0) + r.value;
          return totals;
        },
        {} as Record<string, number>,
      ),
    },
    limitations: [
      '每日独立访客不等于跨日去重人数；不据此推算会话。',
      '页面汇总、访问关联、历史累计和每日汇总各自保留，重叠部分不叠加。',
      '首末访问的时间差不是可见停留时间；缺失的动作或停留不补造。',
      '本工具不修改 Weava 原生事件、Puock 浏览量、文章或公开版本。',
    ],
  };
}
const hasHistory = (db: Database.Database) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wp_statistics_sources'")
    .get();
function activeSource(db: Database.Database, sourceId: string) {
  return hasHistory(db)
    ? (db.prepare('SELECT * FROM wp_statistics_sources WHERE source_id=?').get(sourceId) as any)
    : undefined;
}
function database(root: string, name: string) {
  return new Database(join(root, name), { readonly: true, fileMustExist: true });
}
function pagePath(uri: string) {
  try {
    return normalizePath(new URL(uri || '/', 'https://placeholder.invalid').pathname);
  } catch {
    return null;
  }
}
function mappings(root: string, snapshot: WordpressStatisticsSnapshot) {
  const db = database(root, 'weava.sqlite');
  try {
    const entries = db.prepare("SELECT id,data FROM records WHERE scope='entry'").all() as {
      id: string;
      data: string;
    }[];
    const paths = new Map<string, string>(),
      postIds = new Map<string, string>(),
      targetPaths = new Map<string, string>();
    for (const row of entries) {
      const entry = JSON.parse(row.data);
      paths.set(entry.path, row.id);
      targetPaths.set(row.id, entry.path);
      if (entry.source?.system === 'wordpress' && entry.source.id != null) {
        const origin = entry.source.originalUrl;
        if (
          origin &&
          new URL(origin, snapshot.source.siteUrl).origin !==
            new URL(snapshot.source.siteUrl).origin
        )
          continue;
        postIds.set(String(entry.source.id), row.id);
      }
    }
    const mapped = snapshot.tables.pages.rows.map((row) => {
      const path = pagePath(row.uri);
      return {
        id: row.id,
        uri: row.uri,
        path,
        entryId:
          (row.type === 'post' || row.type === 'page'
            ? postIds.get(String(row.objectId))
            : undefined) ||
          (path ? paths.get(path) : undefined) ||
          null,
      };
    });
    return {
      rows: mapped,
      hash: digest(
        stable(
          mapped.map((row) => ({
            ...row,
            targetPath: row.entryId ? targetPaths.get(row.entryId) || null : null,
          })),
        ),
      ),
      matched: mapped.filter((r) => r.entryId).length,
      unmatched: mapped
        .filter((r) => !r.entryId)
        .map((r) => r.uri)
        .filter((value, index, all) => all.indexOf(value) === index)
        .sort(),
    };
  } finally {
    db.close();
  }
}
export function planWordpressStatistics(input: string, target: string) {
  const root = resolve(target),
    snapshot = readWordpressStatistics(input),
    info = inspectWordpressStatistics(snapshot),
    map = mappings(root, snapshot);
  const db = database(root, 'analytics.sqlite');
  let previous: any, native: any, baselines: any;
  try {
    previous = activeSource(db, info.sourceId);
    native = db.prepare('SELECT kind,COUNT(*) count FROM events GROUP BY kind').all();
    baselines = db
      .prepare(
        'SELECT source_id,COUNT(*) entries,SUM(views) views FROM historical_views GROUP BY source_id',
      )
      .all();
  } finally {
    db.close();
  }
  const unchanged = previous?.content_hash === info.contentHash;
  if (previous && !unchanged && previous.captured_at >= info.capturedAt)
    throw new WeavaError('来源快照比已导入版本旧，或同一采集时间内容冲突。', 409);
  const action = unchanged ? 'unchanged' : previous ? 'replace-source-snapshot' : 'import';
  const review = {
    version: 1,
    target: root,
    sourceId: info.sourceId,
    fingerprint: info.fingerprint,
    contentHash: info.contentHash,
    previousFingerprint: previous?.fingerprint || null,
    mappingHash: map.hash,
  };
  return {
    schema: 'weava-wp-statistics-plan-v1',
    ...info,
    target: root,
    action,
    canApply: true,
    mapping: { matched: map.matched, total: map.rows.length, unmatched: map.unmatched },
    existing: { source: previous || null, nativeEvents: native, independentCounters: baselines },
    review: { ...review, token: digest(stable(review)) },
    warnings: [
      ...(map.unmatched.length ? ['部分旧网址尚未映射到内容，仍保留原网址和统计，不丢弃。'] : []),
      ...(baselines.length ? ['目标已有独立累计计数器，本次不会与它相加或覆盖。'] : []),
    ],
  };
}
function initialize(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS wp_statistics_sources(source_id TEXT PRIMARY KEY,site_url TEXT NOT NULL,fingerprint TEXT NOT NULL,content_hash TEXT NOT NULL,captured_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wp_statistics_snapshots(fingerprint TEXT PRIMARY KEY,source_id TEXT NOT NULL,content_hash TEXT NOT NULL,captured_at TEXT NOT NULL,imported_at TEXT NOT NULL,archive TEXT NOT NULL,metadata TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wp_statistics_rows(fingerprint TEXT NOT NULL,table_name TEXT NOT NULL,row_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(fingerprint,table_name,row_id));
  CREATE TABLE IF NOT EXISTS wp_statistics_page_map(fingerprint TEXT NOT NULL,page_id INTEGER NOT NULL,path TEXT,entry_id TEXT,PRIMARY KEY(fingerprint,page_id));
  CREATE INDEX IF NOT EXISTS wp_statistics_source_snapshots ON wp_statistics_snapshots(source_id,captured_at);`);
}
export async function importWordpressStatistics(
  input: string,
  target: string,
  reviewInput: unknown,
) {
  const plan = planWordpressStatistics(input, target);
  if (stable(reviewInput) !== stable(plan.review))
    throw new WeavaError('来源、目标或页面映射已变化，请重新预检。', 409);
  if (plan.action === 'unchanged') {
    verifyWordpressStatistics(plan.target, plan.sourceId);
    return { ...plan, changed: false, backup: null };
  }
  assertOffline(plan.target);
  const snapshot = readWordpressStatistics(input);
  if (metadata(snapshot).fingerprint !== plan.fingerprint)
    throw new WeavaError('快照文件在预检后发生变化。', 409);
  const map = mappings(plan.target, snapshot),
    archive = join(plan.target, 'imports', 'wp-statistics', plan.fingerprint);
  if (map.hash !== plan.review.mappingHash)
    throw new WeavaError('页面映射已变化，请重新预检。', 409);
  const db = new Database(join(plan.target, 'analytics.sqlite'), { fileMustExist: true });
  db.pragma('busy_timeout=5000');
  try {
    mkdirSync(archive, { recursive: true });
    const backup = join(archive, 'before-' + crypto.randomUUID() + '.sqlite');
    await db.backup(backup);
    const snapshotFile = join(archive, 'snapshot.json');
    if (!existsSync(snapshotFile))
      writeFileSync(snapshotFile, JSON.stringify(snapshot), { flag: 'wx' });
    else if (metadata(readWordpressStatistics(snapshotFile)).fingerprint !== plan.fingerprint)
      throw new WeavaError('已有快照归档校验失败。');
    const result = db
      .transaction(() => {
        const current = activeSource(db, plan.sourceId);
        if ((current?.fingerprint || null) !== plan.review.previousFingerprint)
          throw new WeavaError('另一项导入已修改此来源，请重新预检。', 409);
        initialize(db);
        const importedAt = new Date().toISOString();
        db.prepare('INSERT INTO wp_statistics_snapshots VALUES(?,?,?,?,?,?,?)').run(
          plan.fingerprint,
          plan.sourceId,
          plan.contentHash,
          plan.capturedAt,
          importedAt,
          snapshotFile,
          JSON.stringify({
            source: snapshot.source,
            missingColumns: snapshot.missingColumns,
            inspection: inspectWordpressStatistics(snapshot),
            mapping: map.rows,
          }),
        );
        const insert = db.prepare('INSERT INTO wp_statistics_rows VALUES(?,?,?,?)');
        for (const table of tableNames)
          for (const row of snapshot.tables[table].rows)
            insert.run(plan.fingerprint, table, row.id, JSON.stringify(row));
        const page = db.prepare('INSERT INTO wp_statistics_page_map VALUES(?,?,?,?)');
        for (const row of map.rows) page.run(plan.fingerprint, row.id, row.path, row.entryId);
        db.prepare(
          'INSERT INTO wp_statistics_sources VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET fingerprint=excluded.fingerprint,content_hash=excluded.content_hash,captured_at=excluded.captured_at',
        ).run(plan.sourceId, plan.siteUrl, plan.fingerprint, plan.contentHash, plan.capturedAt);
        return { ...plan, changed: true, backup, archive: snapshotFile, importedAt };
      })
      .immediate();
    writeFileSync(
      join(archive, 'receipt-' + crypto.randomUUID() + '.json'),
      JSON.stringify(result, null, 2),
      { flag: 'wx' },
    );
    return result;
  } finally {
    db.close();
  }
}
export function wordpressStatisticsSources(root: string) {
  const db = database(resolve(root), 'analytics.sqlite');
  try {
    return hasHistory(db)
      ? db.prepare('SELECT * FROM wp_statistics_sources ORDER BY site_url').all()
      : [];
  } finally {
    db.close();
  }
}
export function verifyWordpressStatistics(root: string, sourceId?: string) {
  const target = resolve(root),
    db = database(target, 'analytics.sqlite');
  try {
    if (!hasHistory(db)) throw new WeavaError('尚未导入 WP Statistics。', 404);
    const sources = db
      .prepare('SELECT * FROM wp_statistics_sources ORDER BY site_url')
      .all() as any[];
    const selected = sourceId ? sources.filter((s) => s.source_id === sourceId) : sources;
    if (!selected.length) throw new WeavaError('统计来源不存在。', 404);
    const verified = selected.map((active) => {
      const snapshotFile = join(
          target,
          'imports',
          'wp-statistics',
          active.fingerprint,
          'snapshot.json',
        ),
        snapshot = readWordpressStatistics(snapshotFile),
        info = metadata(snapshot);
      if (
        info.fingerprint !== active.fingerprint ||
        info.contentHash !== active.content_hash ||
        info.capturedAt !== active.captured_at
      )
        throw new WeavaError('快照归档与来源记录不一致。');
      const stored = db
        .prepare('SELECT * FROM wp_statistics_snapshots WHERE fingerprint=?')
        .get(active.fingerprint) as any;
      if (
        !stored ||
        stored.source_id !== active.source_id ||
        stored.content_hash !== active.content_hash
      )
        throw new WeavaError('快照登记不一致。');
      for (const name of tableNames) {
        const rows = (
          db
            .prepare(
              'SELECT data FROM wp_statistics_rows WHERE fingerprint=? AND table_name=? ORDER BY row_id',
            )
            .all(active.fingerprint, name) as { data: string }[]
        ).map((r) => JSON.parse(r.data));
        if (stable(rows) !== stable([...snapshot.tables[name].rows].sort((a, b) => a.id - b.id)))
          throw new WeavaError('已导入的来源表校验失败：' + name);
      }
      const mapped = (
        db
          .prepare(
            'SELECT page_id FROM wp_statistics_page_map WHERE fingerprint=? ORDER BY page_id',
          )
          .all(active.fingerprint) as { page_id: number }[]
      ).map((r) => r.page_id);
      if (
        stable(mapped) !== stable(snapshot.tables.pages.rows.map((r) => r.id).sort((a, b) => a - b))
      )
        throw new WeavaError('页面映射记录不完整。');
      const pageUris = new Map(snapshot.tables.pages.rows.map((row) => [row.id, row.uri]));
      const mappedRows = (
        db
          .prepare(
            'SELECT page_id id,path,entry_id entryId FROM wp_statistics_page_map WHERE fingerprint=? ORDER BY page_id',
          )
          .all(active.fingerprint) as any[]
      ).map((row) => ({
        ...row,
        uri: pageUris.get(row.id),
      }));
      const mapping = JSON.parse(stored.metadata).mapping;
      if (
        !Array.isArray(mapping) ||
        stable(mappedRows) !== stable([...mapping].sort((a, b) => a.id - b.id))
      )
        throw new WeavaError('页面映射内容校验失败。');
      return {
        sourceId: active.source_id,
        fingerprint: active.fingerprint,
        archive: snapshotFile,
        counts: inspectWordpressStatistics(snapshot).counts,
      };
    });
    return { ok: true, sources: verified };
  } finally {
    db.close();
  }
}
export function wordpressStatisticsReport(root: string, params = new URLSearchParams()) {
  const db = database(resolve(root), 'analytics.sqlite');
  try {
    if (!hasHistory(db)) throw new WeavaError('尚未导入 WP Statistics。', 404);
    const sources = db
      .prepare('SELECT * FROM wp_statistics_sources ORDER BY site_url')
      .all() as any[];
    const sourceId = params.get('source') || (sources.length === 1 ? sources[0].source_id : '');
    const active = activeSource(db, sourceId);
    if (!active) throw new WeavaError('请通过 source 指定已有 WP Statistics 来源。', 404);
    const meta = db
      .prepare('SELECT * FROM wp_statistics_snapshots WHERE fingerprint=?')
      .get(active.fingerprint) as any;
    const load = (name: WordpressStatisticsTable) =>
      (
        db
          .prepare(
            'SELECT data FROM wp_statistics_rows WHERE fingerprint=? AND table_name=? ORDER BY row_id',
          )
          .all(active.fingerprint, name) as { data: string }[]
      ).map((row) => JSON.parse(row.data));
    const info = JSON.parse(meta.metadata),
      start = params.get('start') || '0001-01-01',
      end = params.get('end') || '9999-12-31',
      path = params.get('path') ? normalizePath(params.get('path')!) : null;
    if (!day.safeParse(start).success || !day.safeParse(end).success || start > end)
      throw new WeavaError('日期范围无效。');
    const inRange = (date: string) => date >= start && date <= end;
    const allPages = load('pages') as z.infer<typeof page>[],
      pages = allPages.filter((p) => inRange(p.day) && (!path || pagePath(p.uri) === path));
    const pageMap = new Map(allPages.map((p) => [p.id, p]));
    const allVisitors = load('visitors') as z.infer<typeof visitor>[];
    const allRelations = load('relationships') as z.infer<typeof relationship>[];
    const selectedRelations = allRelations.filter(
      (r) =>
        inRange(r.at.slice(0, 10)) &&
        (!path || pagePath(pageMap.get(r.pageId)?.uri || '') === path),
    );
    const pathVisitors = path ? new Set(selectedRelations.map((r) => r.visitorId)) : null;
    const visitors = allVisitors.filter((v) =>
      pathVisitors ? pathVisitors.has(v.id) : inRange(v.day),
    );
    const summaries = load('daily') as z.infer<typeof daily>[],
      byDay = new Map<string, any>();
    for (const p of pages) {
      const d = byDay.get(p.day) || {
        day: p.day,
        views: 0,
        visitors: null,
        basis: 'page-aggregates',
      };
      d.views += p.views;
      byDay.set(p.day, d);
    }
    if (!path)
      for (const row of summaries.filter((r) => inRange(r.day)))
        byDay.set(row.day, {
          day: row.day,
          views: row.views,
          visitors: row.visitors,
          basis: 'daily-summary',
        });
    for (const v of visitors) {
      if (!byDay.has(v.day))
        byDay.set(v.day, { day: v.day, views: null, visitors: null, basis: 'visitor-records' });
    }
    const dimensions = (key: keyof z.infer<typeof visitor>) => {
      const counts = new Map<string, number>();
      for (const v of visitors) {
        const name = String(v[key] || '未知');
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      return [...counts]
        .map(([name, records]) => ({ name, records }))
        .sort((a, b) => b.records - a.records);
    };
    const ranking = new Map<string, any>();
    for (const p of pages) {
      const row = ranking.get(p.uri) || { uri: p.uri, path: pagePath(p.uri), views: 0 };
      row.views += p.views;
      ranking.set(p.uri, row);
    }
    const limit = 50,
      requested = Number(params.get('page')) || 1,
      number = Number.isSafeInteger(requested) ? Math.max(1, Math.min(1000000, requested)) : 1,
      visitorId = Number(params.get('visitor')) || null;
    const selectedVisitor = visitorId ? allVisitors.find((v) => v.id === visitorId) || null : null;
    if (visitorId && !selectedVisitor) throw new WeavaError('来源访客编号不存在。', 404);
    const activity = visitorId
      ? allRelations
          .filter(
            (r) =>
              r.visitorId === visitorId &&
              inRange(r.at.slice(0, 10)) &&
              (!path || pagePath(pageMap.get(r.pageId)?.uri || '') === path),
          )
          .map((r) => ({ ...r, uri: pageMap.get(r.pageId)?.uri || null }))
          .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
      : [];
    return {
      sourceId,
      capturedAt: active.captured_at,
      timezone: info.source.timezone,
      source: info.source,
      range: { start: params.get('start'), end: params.get('end'), path },
      totals: {
        visitorRecords: visitors.length,
        relationshipRecords: selectedRelations.length,
        pageAggregateViews: pages.reduce((n, p) => n + p.views, 0),
        dailySummaryViews: !path
          ? summaries.filter((r) => inRange(r.day)).reduce((n, r) => n + r.views, 0)
          : null,
        uniqueVisitors: null,
        sessions: null,
        activeMs: null,
      },
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      pages: [...ranking.values()].sort((a, b) => b.views - a.views || a.uri.localeCompare(b.uri)),
      countries: dimensions('country'),
      browsers: dimensions('browser'),
      operatingSystems: dimensions('os'),
      devices: dimensions('device'),
      models: dimensions('model'),
      sources: visitors.reduce((result: any[], v) => {
        const classification = referral(v.referrer || '');
        const name = v.sourceName || classification.engine || v.referrer || '直接 / 未知',
          key = JSON.stringify([v.sourceChannel, name]);
        let row = result.find((r) => r.key === key);
        if (!row) {
          row = { key, originalChannel: v.sourceChannel, name, records: 0 };
          result.push(row);
        }
        row.records++;
        return result;
      }, []),
      visitors: {
        total: visitors.length,
        page: number,
        pageSize: limit,
        items: [...visitors]
          .sort((a, b) => (b.lastView || b.day).localeCompare(a.lastView || a.day) || b.id - a.id)
          .slice((number - 1) * limit, number * limit),
      },
      visitor: selectedVisitor,
      activity: {
        total: activity.length,
        page: number,
        pageSize: limit,
        items: activity.slice((number - 1) * limit, number * limit),
      },
      historical: load('historical').filter((r) => !path || pagePath(r.uri || '') === path),
      events: load('events').filter(
        (r) =>
          inRange(r.at.slice(0, 10)) &&
          (!path || pagePath(pageMap.get(r.pageId)?.uri || '') === path),
      ),
      limitations: info.inspection.limitations,
    };
  } finally {
    db.close();
  }
}
