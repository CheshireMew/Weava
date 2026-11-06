import * as z from 'zod';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { digest } from '../../../runtime-common/src/identity.ts';

export const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const id = int.min(1),
  text = z.string().max(10000),
  optionalText = text.nullable();

export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '日期不存在',
  );

export const datetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v.replace(' ', 'T') + 'Z')) &&
      new Date(v.replace(' ', 'T') + 'Z').toISOString().slice(0, 19) === v.replace(' ', 'T'),
    '时间无效',
  );

export const visitor = z
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

export const page = z
  .object({ id, uri: text, type: text, day, views: int, objectId: int })
  .strict();

export const relationship = z.object({ id, visitorId: id, pageId: id, at: datetime }).strict();

export const daily = z.object({ id, day, visitors: int, views: int }).strict();

export const historical = z
  .object({
    id,
    category: text,
    pageId: z.number().int().min(-2).max(Number.MAX_SAFE_INTEGER).nullable(),
    uri: optionalText,
    value: int,
  })
  .strict();

export const event = z
  .object({ id, at: datetime, pageId: int.nullable(), visitorId: int.nullable(), name: text })
  .strict();

export const table = <T extends z.ZodType>(row: T) =>
  z
    .object({
      present: z.boolean(),
      count: int,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      rows: z.array(row),
    })
    .strict();

export const schema = z
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

export const tableNames: WordpressStatisticsTable[] = [
  'visitors',
  'pages',
  'relationships',
  'daily',
  'historical',
  'events',
];

export const maxBytes = 128 * 1024 * 1024;

export function stable(value: any): string {
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

export function sourceIdentity(siteUrl: string) {
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

export function validTimezone(zone: string) {
  if (/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone)) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date());
  } catch {
    throw new WeavaError('来源时区无效。');
  }
}

export function unique(rows: { id: number }[], name: string) {
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

export function metadata(snapshot: WordpressStatisticsSnapshot) {
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
