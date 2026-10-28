import Database from 'better-sqlite3';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { normalizePath } from './site.ts';
export interface HistoricalViewImport {
  sourceId: string;
  capturedAt: string;
  entries: { entryId: string; path: string; views: number }[];
}
export class Analytics {
  raw: Database.Database;
  constructor(root: string) {
    this.raw = new Database(join(root, 'analytics.sqlite'));
    this.raw.pragma('journal_mode=WAL');
    this.raw.pragma('busy_timeout=5000');
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,release_id TEXT NOT NULL);CREATE INDEX IF NOT EXISTS event_date ON events(ts,path);CREATE TABLE IF NOT EXISTS legacy_sources(id TEXT PRIMARY KEY,path TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS historical_views(entry_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,path TEXT NOT NULL,views INTEGER NOT NULL CHECK(views>=0),captured_at TEXT NOT NULL);`,
    );
  }
  collect(value: any, agent: string, allowed: Set<string>) {
    if (/bot|crawler|headless|playwright/i.test(agent)) return { accepted: 0 };
    const batch = Array.isArray(value) ? value : [value];
    if (batch.length > 100) throw new WeavaError('事件数量过多。');
    let count = 0;
    const insert = this.raw.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    this.raw.transaction(() => {
      for (const item of batch) {
        if (!item || !['view', 'click'].includes(item.kind) || typeof item.path !== 'string') continue;
        let path: string;
        try { path = normalizePath(item.path); } catch { continue; }
        if (!allowed.has(path)) continue;
        const ts = Date.parse(item.ts);
        if (!Number.isFinite(ts) || ts > Date.now() + 300000 || ts < Date.now() - 7 * 86400000)
          continue;
        if (!/^[\w-]{10,100}$/.test(item.id ?? '')) continue;
        let ref = '';
        try {
          ref = new URL(item.referrer).hostname;
        } catch {}
        count += insert.run(
          item.id,
          item.kind,
          new Date(ts).toISOString(),
          path,
          String(item.visitor ?? '').slice(0, 100),
          String(item.session ?? '').slice(0, 100),
          String(item.url ?? '').slice(0, 4000),
          String(item.label ?? '').slice(0, 200),
          String(item.zone ?? 'body'),
          ref,
          String(item.releaseId ?? ''),
        ).changes;
      }
    })();
    return { accepted: count };
  }
  importViewTotals(input: HistoricalViewImport) {
    if (!input.sourceId?.trim() || !Number.isFinite(Date.parse(input.capturedAt)) || !Array.isArray(input.entries))
      throw new WeavaError('历史浏览量来源或时间无效。');
    const seen = new Set<string>();
    const entries = input.entries.map((item) => {
      if (!item.entryId?.trim() || seen.has(item.entryId) || !Number.isSafeInteger(item.views) || item.views < 0)
        throw new WeavaError('历史浏览量编号重复或计数无效。');
      seen.add(item.entryId);
      return { ...item, path: normalizePath(item.path) };
    });
    const capturedAt = new Date(input.capturedAt).toISOString();
    return this.raw.transaction(() => {
      const find = this.raw.prepare('SELECT source_id,captured_at FROM historical_views WHERE entry_id=?');
      const upsert = this.raw.prepare(`INSERT INTO historical_views VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET path=excluded.path,views=excluded.views,captured_at=excluded.captured_at
        WHERE historical_views.path<>excluded.path OR historical_views.views<>excluded.views OR historical_views.captured_at<>excluded.captured_at`);
      let changed = 0;
      for (const item of entries) {
        const previous = find.get(item.entryId) as { source_id: string; captured_at: string } | undefined;
        if (previous && previous.source_id !== input.sourceId)
          throw new WeavaError('这篇文章已有其他来源的历史浏览量，不能重复叠加：' + item.entryId, 409);
        if (previous && previous.captured_at > capturedAt)
          throw new WeavaError('历史浏览量快照比已导入的数据旧。', 409);
        changed += upsert.run(item.entryId, input.sourceId, item.path, item.views, capturedAt).changes;
      }
      return { sourceId: input.sourceId, capturedAt, entries: entries.length, views: entries.reduce((sum, item) => sum + item.views, 0), changed };
    }).immediate();
  }
  viewTotals(entries: { id: string; path: string }[]) {
    const historical = new Map((this.raw.prepare('SELECT entry_id,views FROM historical_views').all() as any[]).map((row) => [row.entry_id, row.views]));
    const recorded = new Map((this.raw.prepare("SELECT path,COUNT(*) views FROM events WHERE kind='view' GROUP BY path").all() as any[]).map((row) => [row.path, row.views]));
    return new Map(entries.map((entry) => [entry.id, (historical.get(entry.id) ?? 0) + (recorded.get(normalizePath(entry.path)) ?? 0)]));
  }
  lifetime() {
    const pages = new Map<string, { path: string; views: number; historicalViews: number; recordedViews: number }>();
    const page = (path: string) => {
      let row = pages.get(path);
      if (!row) { row = { path, views: 0, historicalViews: 0, recordedViews: 0 }; pages.set(path, row); }
      return row;
    };
    for (const row of this.raw.prepare('SELECT path,SUM(views) views FROM historical_views GROUP BY path').all() as any[])
      page(row.path).historicalViews = row.views;
    for (const row of this.raw.prepare("SELECT path,COUNT(*) views FROM events WHERE kind='view' GROUP BY path").all() as any[])
      page(row.path).recordedViews = row.views;
    for (const row of pages.values()) row.views = row.historicalViews + row.recordedViews;
    const rows = [...pages.values()].sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));
    return { lifetimeViews: rows.reduce((sum, row) => sum + row.views, 0), historicalViews: rows.reduce((sum, row) => sum + row.historicalViews, 0), lifetimePages: rows };
  }
  report(params: URLSearchParams, timezone = 'Asia/Shanghai') {
    const start = params.get('start') || '1970-01-01',
      end = params.get('end') || '2999-01-01',
      path = params.get('path');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
      throw new WeavaError('日期范围无效。');
    const rows = this.raw
      .prepare(
        'SELECT * FROM events WHERE ts>=? AND ts<?' + (path ? ' AND path=?' : '') + ' ORDER BY ts',
      )
      .all(
        ...[
          new Date(Date.parse(start) - 86400000).toISOString(),
          new Date(Date.parse(end) + 2 * 86400000).toISOString(),
          ...(path ? [path] : []),
        ],
      ) as any[];
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const events = rows.filter((r) => {
      const day = fmt.format(new Date(r.ts));
      return day >= start && day <= end;
    });
    const pages = new Map<string, any>(),
      daily = new Map<string, any>(),
      links = new Map<string, any>();
    for (const ev of events) {
      const p = pages.get(ev.path) ?? { path: ev.path, views: 0, clicks: 0 };
      p[ev.kind === 'view' ? 'views' : 'clicks']++;
      pages.set(ev.path, p);
      const date = fmt.format(new Date(ev.ts)),
        d = daily.get(date) ?? { date, views: 0, clicks: 0 };
      d[ev.kind === 'view' ? 'views' : 'clicks']++;
      daily.set(date, d);
      if (ev.kind === 'click') {
        const key = [ev.path, ev.url, ev.zone, ev.label].join('|'),
          l = links.get(key) ?? {
            path: ev.path,
            url: ev.url,
            zone: ev.zone,
            label: ev.label,
            clicks: 0,
          };
        l.clicks++;
        links.set(key, l);
      }
    }
    return {
      views: events.filter((e) => e.kind === 'view').length,
      visitors: new Set(events.filter((e) => e.kind === 'view').map((e) => e.visitor)).size,
      sessions: new Set(events.map((e) => e.session)).size,
      clicks: events.filter((e) => e.kind === 'click').length,
      pages: [...pages.values()].sort((a, b) => b.views - a.views),
      daily: [...daily.values()],
      links: [...links.values()],
      legacySources: this.raw.prepare('SELECT id,path FROM legacy_sources').all(),
      ...this.lifetime(),
    };
  }
  close() {
    this.raw.close();
  }
}
export function csv(rows: any[]) {
  if (!rows.length) return '\ufeff';
  const keys = Object.keys(rows[0]);
  const cell = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return (
    '\ufeff' +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))].map((r) => r.map(cell).join(',')).join('\r\n')
  );
}
