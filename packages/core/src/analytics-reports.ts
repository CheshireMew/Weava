import {queryAnalyticsReport} from './analytics-query.ts';
import type Database from 'better-sqlite3';
import {WeavaError} from '../../contracts/src/errors.ts';


import {wordpressVisitor} from './analytics-wordpress.ts';

import {dayInZone,dayStart,shiftDay,validDay} from './analytics-dates.ts';
export {dayInZone,dayStart,shiftDay} from './analytics-dates.ts';
export {realtimeReport} from './analytics-realtime.ts';
import {decorate,visitorId} from './analytics-events.ts';
const sessionId = (e: any) => JSON.stringify([visitorId(e), e.session || e.id]);
const byViews = (a: any, b: any) =>
  b.views - a.views ||
  String(a.path || a.name || a.host || '').localeCompare(String(b.path || b.name || b.host || ''));
const joined = `SELECT e.*,c.country,c.browser,c.os,c.device,c.model,c.language,c.channel,c.engine,c.source,c.medium,c.campaign,
  COALESCE(a.active_ms,0) active_ms,COALESCE(a.scroll,0) scroll,a.last_seen,COALESCE(a.closed,0) closed FROM events e
  LEFT JOIN event_context c ON c.event_id=e.id LEFT JOIN page_activity a ON a.view_id=e.id`;
function summary(events: any[]) {
  const views = events.filter((e) => e.kind === 'view');
  return {
    views: views.length,
    visitors: new Set(views.map(visitorId)).size,
    sessions: new Set(views.map(sessionId)).size,
    clicks: events.filter((e) => e.kind === 'click').length,
  };
}
function viewSessions(views: any[]) {
  const grouped = new Map<string, any[]>();
  for (const view of views) {
    const key = sessionId(view);
    const rows = grouped.get(key) || [];
    rows.push(view);
    grouped.set(key, rows);
  }
  return grouped;
}
export function analyticsReport(db: Database.Database, params: URLSearchParams, timezone: string, clock = Date.now()) {
  return queryAnalyticsReport(db,params,timezone,clock);
}
export function visitorReport(
  db: Database.Database,
  id: string,
  params: URLSearchParams,
  timezone: string,
) {
  if (!id || id.length > 200) throw new WeavaError('访客编号无效。');
  const today = dayInZone(new Date(), timezone),
    start = params.get('start') || shiftDay(today, -29),
    end = params.get('end') || today;
  if (!validDay(start) || !validDay(end) || start > end) throw new WeavaError('日期范围无效。');
  const imported = wordpressVisitor(db, id, new URLSearchParams({ ...Object.fromEntries(params), start, end }), timezone);
  if (imported) return imported;
  const suppliedPage = Number(params.get('page'));
  const page = Number.isSafeInteger(suppliedPage)
      ? Math.max(1, Math.min(1000000, suppliedPage))
      : 1,
    pageSize = 50;
  const args = [
    id,
    id.startsWith('legacy-') ? id.slice(7) : '',
    dayStart(start, timezone),
    dayStart(shiftDay(end, 1), timezone),
  ];
  const total = (
    db
      .prepare(
        "SELECT COUNT(*) count FROM events WHERE (visitor=? OR (visitor='' AND id=?)) AND ts>=? AND ts<?",
      )
      .get(...args) as any
  ).count;
  const rows = (
    db
      .prepare(
        joined +
          " WHERE (e.visitor=? OR (e.visitor='' AND e.id=?)) AND e.ts>=? AND e.ts<? ORDER BY e.ts DESC,e.id DESC LIMIT ? OFFSET ?",
      )
      .all(...args, pageSize, (page - 1) * pageSize) as any[]
  ).map(decorate);
  return {
    id,
    start,
    end,
    timezone,
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
    events: rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      ts: e.ts,
      path: e.path,
      session: e.session,
      url: e.url,
      label: e.label,
      zone: e.zone,
      referrer: e.referrer,
      country: e.country,
      browser: e.browser,
      os: e.os,
      device: e.device,
      model: e.model,
      activeMs: e.active_ms,
      scroll: e.scroll,
      channel: e.channel,
    })),
  };
}
