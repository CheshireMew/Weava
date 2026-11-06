import type Database from 'better-sqlite3';
import { normalizePath } from './paths.ts';
import { decorate, visitorId } from './analytics-events.ts';
export function realtimeReport(
  db: Database.Database,
  params = new URLSearchParams(),
  clock = Date.now(),
) {
  const path = params.get('path') ? normalizePath(params.get('path')!) : '';
  const args = [new Date(clock - 5 * 60000).toISOString(), ...(path ? [path] : [])];
  const from = ` FROM page_activity a INDEXED BY activity_open_seen JOIN events e ON e.id=a.view_id LEFT JOIN event_context c ON c.event_id=e.id WHERE a.closed=0 AND a.last_seen>=? AND e.kind='view'${path ? ' AND e.path=?' : ''}`;
  const count = (
    db
      .prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id)) count" + from)
      .get(...args) as { count: number }
  ).count;
  const rows = db
    .prepare(
      `WITH ranked AS(SELECT e.id,e.visitor,e.session,e.path,e.ts,a.last_seen,c.country,c.browser,c.os,c.device,
    ROW_NUMBER() OVER(PARTITION BY COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id) ORDER BY a.last_seen DESC,e.ts,e.id) position${from})
    SELECT * FROM ranked WHERE position=1 ORDER BY last_seen DESC,ts,id LIMIT 100`,
    )
    .all(...args) as any[];
  return {
    count,
    windowMinutes: 5,
    at: new Date(clock).toISOString(),
    visitors: rows
      .map(decorate)
      .map((row) => ({
        id: visitorId(row),
        session: row.session,
        path: row.path,
        lastSeen: row.last_seen,
        country: row.country,
        browser: row.browser,
        os: row.os,
        device: row.device,
      })),
  };
}
