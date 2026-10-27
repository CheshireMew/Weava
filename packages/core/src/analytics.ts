import Database from 'better-sqlite3';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';
export class Analytics {
  raw: Database.Database;
  constructor(root: string) {
    this.raw = new Database(join(root, 'analytics.sqlite'));
    this.raw.pragma('journal_mode=WAL');
    this.raw.pragma('busy_timeout=5000');
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,release_id TEXT NOT NULL);CREATE INDEX IF NOT EXISTS event_date ON events(ts,path);CREATE TABLE IF NOT EXISTS legacy_sources(id TEXT PRIMARY KEY,path TEXT NOT NULL,data TEXT NOT NULL);`,
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
        if (!item || !['view', 'click'].includes(item.kind) || !allowed.has(item.path)) continue;
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
          item.path,
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
