import Database from 'better-sqlite3';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { normalizePath } from './site.ts';
import { AnalyticsGeo } from './analytics-geo.ts';
import { deviceInfo, referral, type AnalyticsContext } from './analytics-dimensions.ts';
import { analyticsReport, realtimeReport, visitorReport } from './analytics-reports.ts';
export interface HistoricalViewImport {
  sourceId: string;
  capturedAt: string;
  entries: { entryId: string; path: string; views: number }[];
}
export class Analytics {
  raw: Database.Database;
  geo: AnalyticsGeo;
  constructor(root: string) {
    this.geo = new AnalyticsGeo(root);
    this.raw = new Database(join(root, 'analytics.sqlite'));
    this.raw.pragma('journal_mode=WAL');
    this.raw.pragma('busy_timeout=5000');
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,release_id TEXT NOT NULL);CREATE INDEX IF NOT EXISTS event_date ON events(ts,path);CREATE TABLE IF NOT EXISTS legacy_sources(id TEXT PRIMARY KEY,path TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS historical_views(entry_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,path TEXT NOT NULL,views INTEGER NOT NULL CHECK(views>=0),captured_at TEXT NOT NULL);`,
    );
    this.raw
      .exec(`CREATE TABLE IF NOT EXISTS event_context(event_id TEXT PRIMARY KEY,country TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,device TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,channel TEXT NOT NULL,engine TEXT NOT NULL,source TEXT NOT NULL,medium TEXT NOT NULL,campaign TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS page_activity(view_id TEXT PRIMARY KEY,last_seen TEXT NOT NULL,active_ms INTEGER NOT NULL,scroll INTEGER NOT NULL,closed INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS activity_seen ON page_activity(last_seen,closed);
      CREATE INDEX IF NOT EXISTS event_session ON events(visitor,session,ts);
      CREATE INDEX IF NOT EXISTS event_kind_date ON events(kind,ts);`);
    this.raw.exec(
      'CREATE TABLE IF NOT EXISTS crawler_requests(id TEXT PRIMARY KEY,ts TEXT NOT NULL,path TEXT NOT NULL,agent TEXT NOT NULL,status INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS crawler_date ON crawler_requests(ts,path);',
    );
  }
  collect(value: any, agent: string, allowed: Set<string>, context: AnalyticsContext = {}) {
    if (/bot|crawler|spider|headless|playwright|preview|slurp/i.test(agent)) return { accepted: 0 };
    const batch = Array.isArray(value) ? value : [value];
    if (batch.length > 100) throw new WeavaError('事件数量过多。');
    let count = 0;
    const insert = this.raw.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const detail = this.raw.prepare(
      'INSERT OR IGNORE INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    const activity = this.raw.prepare('INSERT OR IGNORE INTO page_activity VALUES(?,?,0,0,0)');
    const findView = this.raw.prepare(
      "SELECT e.ts FROM events e WHERE e.id=? AND e.kind='view' AND e.visitor=? AND e.session=? AND e.path=?",
    );
    const pulse = this.raw.prepare(
      'UPDATE page_activity SET last_seen=MAX(last_seen,?),active_ms=MAX(active_ms,?),scroll=MAX(scroll,?),closed=CASE WHEN last_seen<=? THEN ? ELSE closed END WHERE view_id=?',
    );
    const country = this.geo.country(context.ip);
    this.raw.transaction(() => {
      for (const item of batch) {
        if (
          !item ||
          !['view', 'click', 'event', 'pulse'].includes(item.kind) ||
          typeof item.path !== 'string'
        )
          continue;
        if (item.kind === 'event' && !/^[\w.:-]{1,80}$/.test(item.label ?? '')) continue;
        let path: string;
        try {
          path = normalizePath(item.path);
        } catch {
          continue;
        }
        if (!allowed.has(path)) continue;
        const ts = Date.parse(item.ts);
        if (!Number.isFinite(ts) || ts > Date.now() + 300000 || ts < Date.now() - 7 * 86400000)
          continue;
        if (!/^[\w-]{10,100}$/.test(item.id ?? '')) continue;
        const visitor = String(item.visitor || 'anonymous-' + item.id).slice(0, 100),
          session = String(item.session || item.id).slice(0, 100),
          at = new Date(ts).toISOString();
        if (item.kind === 'pulse') {
          const view = findView.get(String(item.viewId || ''), visitor, session, path) as
            | { ts: string }
            | undefined;
          if (!view || ts < Date.parse(view.ts)) continue;
          const activeMs = Math.min(
            Math.max(0, Math.round(Number(item.activeMs) || 0)),
            Math.max(0, ts - Date.parse(view.ts)),
          );
          const scroll = Math.min(100, Math.max(0, Math.round(Number(item.scroll) || 0)));
          count += pulse.run(at, activeMs, scroll, at, item.closed ? 1 : 0, item.viewId).changes;
          continue;
        }
        const origin = referral(String(item.referrer || ''), context.origin, item.campaign);
        const added = insert.run(
          item.id,
          item.kind,
          at,
          path,
          visitor,
          session,
          String(item.url ?? '').slice(0, 4000),
          String(item.label ?? '').slice(0, 200),
          String(item.zone ?? 'body').slice(0, 100),
          origin.host,
          String(item.releaseId ?? '').slice(0, 100),
        ).changes;
        if (!added) continue;
        count++;
        const device = deviceInfo(agent, item.hints);
        detail.run(
          item.id,
          country,
          device.browser,
          device.os,
          device.device,
          device.model,
          String(context.language || item.language || '')
            .split(',')[0]
            .slice(0, 35),
          origin.channel,
          origin.engine,
          origin.source,
          origin.medium,
          origin.campaign,
          1,
        );
        if (item.kind === 'view') activity.run(item.id, at);
      }
    })();
    return { accepted: count };
  }
  recordCrawler(path: string, agent: string, status: number) {
    const known =
      /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|Googlebot|bingbot|Bytespider/i.exec(
        agent,
      )?.[0];
    if (!known) return;
    this.raw
      .prepare('INSERT INTO crawler_requests VALUES(?,?,?,?,?)')
      .run(
        crypto.randomUUID(),
        new Date().toISOString(),
        normalizePath(path),
        known.toLowerCase(),
        status,
      );
  }
  importViewTotals(input: HistoricalViewImport) {
    if (
      !input.sourceId?.trim() ||
      !Number.isFinite(Date.parse(input.capturedAt)) ||
      !Array.isArray(input.entries)
    )
      throw new WeavaError('历史浏览量来源或时间无效。');
    const seen = new Set<string>();
    const entries = input.entries.map((item) => {
      if (
        !item.entryId?.trim() ||
        seen.has(item.entryId) ||
        !Number.isSafeInteger(item.views) ||
        item.views < 0
      )
        throw new WeavaError('历史浏览量编号重复或计数无效。');
      seen.add(item.entryId);
      return { ...item, path: normalizePath(item.path) };
    });
    const capturedAt = new Date(input.capturedAt).toISOString();
    return this.raw
      .transaction(() => {
        const find = this.raw.prepare(
          'SELECT source_id,captured_at FROM historical_views WHERE entry_id=?',
        );
        const upsert = this.raw
          .prepare(`INSERT INTO historical_views VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET path=excluded.path,views=excluded.views,captured_at=excluded.captured_at
        WHERE historical_views.path<>excluded.path OR historical_views.views<>excluded.views OR historical_views.captured_at<>excluded.captured_at`);
        let changed = 0;
        for (const item of entries) {
          const previous = find.get(item.entryId) as
            | { source_id: string; captured_at: string }
            | undefined;
          if (previous && previous.source_id !== input.sourceId)
            throw new WeavaError(
              '这篇文章已有其他来源的历史浏览量，不能重复叠加：' + item.entryId,
              409,
            );
          if (previous && previous.captured_at > capturedAt)
            throw new WeavaError('历史浏览量快照比已导入的数据旧。', 409);
          changed += upsert.run(
            item.entryId,
            input.sourceId,
            item.path,
            item.views,
            capturedAt,
          ).changes;
        }
        return {
          sourceId: input.sourceId,
          capturedAt,
          entries: entries.length,
          views: entries.reduce((sum, item) => sum + item.views, 0),
          changed,
        };
      })
      .immediate();
  }
  viewTotals(entries: { id: string; path: string }[]) {
    const historical = new Map(
      (this.raw.prepare('SELECT entry_id,views FROM historical_views').all() as any[]).map(
        (row) => [row.entry_id, row.views],
      ),
    );
    const recorded = new Map(
      (
        this.raw
          .prepare("SELECT path,COUNT(*) views FROM events WHERE kind='view' GROUP BY path")
          .all() as any[]
      ).map((row) => [row.path, row.views]),
    );
    return new Map(
      entries.map((entry) => [
        entry.id,
        (historical.get(entry.id) ?? 0) + (recorded.get(normalizePath(entry.path)) ?? 0),
      ]),
    );
  }
  lifetime(pathFilter?: string) {
    const path = pathFilter ? normalizePath(pathFilter) : '';
    const pages = new Map<
      string,
      { path: string; views: number; historicalViews: number; recordedViews: number }
    >();
    const page = (path: string) => {
      let row = pages.get(path);
      if (!row) {
        row = { path, views: 0, historicalViews: 0, recordedViews: 0 };
        pages.set(path, row);
      }
      return row;
    };
    for (const row of this.raw
      .prepare(
        'SELECT path,SUM(views) views FROM historical_views' +
          (path ? ' WHERE path=?' : '') +
          ' GROUP BY path',
      )
      .all(...(path ? [path] : [])) as any[])
      page(row.path).historicalViews = row.views;
    for (const row of this.raw
      .prepare(
        "SELECT path,COUNT(*) views FROM events WHERE kind='view'" +
          (path ? ' AND path=?' : '') +
          ' GROUP BY path',
      )
      .all(...(path ? [path] : [])) as any[])
      page(row.path).recordedViews = row.views;
    for (const row of pages.values()) row.views = row.historicalViews + row.recordedViews;
    const rows = [...pages.values()].sort(
      (a, b) => b.views - a.views || a.path.localeCompare(b.path),
    );
    return {
      lifetimeViews: rows.reduce((sum, row) => sum + row.views, 0),
      historicalViews: rows.reduce((sum, row) => sum + row.historicalViews, 0),
      lifetimePages: rows,
    };
  }
  report(params: URLSearchParams, timezone = 'Asia/Shanghai') {
    return {
      ...analyticsReport(this.raw, params, timezone),
      ...this.lifetime(params.get('path') || undefined),
      geo: this.geo.status(),
    };
  }
  realtime(params = new URLSearchParams()) {
    return realtimeReport(this.raw, params);
  }
  visitor(id: string, params = new URLSearchParams(), timezone = 'Asia/Shanghai') {
    return visitorReport(this.raw, id, params, timezone);
  }
  export(params: URLSearchParams, timezone = 'Asia/Shanghai') {
    const report = this.report(params, timezone),
      dataset = params.get('dataset') || 'pages';
    const datasets: Record<string, any[]> = {
      pages: report.pages,
      daily: report.daily,
      sources: report.sources,
      countries: report.countries,
      browsers: report.browsers,
      os: report.operatingSystems,
      devices: report.devices,
      models: report.models,
      visitors: report.recentVisitors,
      links: report.links,
      actions: report.actions,
      campaigns: report.campaigns,
      crawlers: report.crawlers,
      lifetime: report.lifetimePages,
    };
    if (!Object.hasOwn(datasets, dataset)) throw new WeavaError('统计导出类型不存在。');
    const columns: Record<string, string[]> = {
      pages: [
        'path',
        'views',
        'visitors',
        'clicks',
        'entries',
        'exits',
        'activeMs',
        'averageActiveMs',
      ],
      daily: [
        'date',
        'views',
        'visitors',
        'sessions',
        'clicks',
        'previousViews',
        'previousVisitors',
      ],
      sources: ['channel', 'host', 'name', 'views', 'sessions', 'visitors'],
      countries: ['name', 'visitors', 'share'],
      browsers: ['name', 'visitors', 'share'],
      os: ['name', 'visitors', 'share'],
      devices: ['name', 'visitors', 'share'],
      models: ['name', 'visitors', 'share'],
      visitors: [
        'id',
        'views',
        'sessions',
        'firstSeen',
        'lastSeen',
        'entryPath',
        'exitPath',
        'country',
        'browser',
        'os',
        'device',
        'model',
        'channel',
        'source',
        'activeMs',
      ],
      links: ['path', 'url', 'zone', 'label', 'clicks'],
      actions: ['name', 'count'],
      campaigns: ['source', 'medium', 'campaign', 'sessions', 'views'],
      crawlers: ['agent', 'path', 'status', 'requests', 'identity'],
      lifetime: ['path', 'views', 'historicalViews', 'recordedViews'],
    };
    return csv(datasets[dataset], columns[dataset]);
  }
  close() {
    this.raw.close();
  }
}
export function csv(rows: any[], columns?: string[]) {
  if (!rows.length && !columns) return '\ufeff';
  const keys = columns || Object.keys(rows[0]);
  const cell = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return (
    '\ufeff' +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))].map((r) => r.map(cell).join(',')).join('\r\n')
  );
}
