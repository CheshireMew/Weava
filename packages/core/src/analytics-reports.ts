import { queryAnalyticsReport } from './analytics-query.ts';
import type Database from 'better-sqlite3';
import { WeavaError } from '../../contracts/src/errors.ts';
import { normalizePath } from './paths.ts';
import { referral } from './analytics-dimensions.ts';

const dayMs = 86400000;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function shiftDay(day: string, amount: number) {
  return new Date(Date.parse(day) + amount * dayMs).toISOString().slice(0, 10);
}
export function dayInZone(date: Date, zone: string) {
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (dayFormatters.size >= 16) dayFormatters.delete(dayFormatters.keys().next().value!);
    dayFormatters.set(zone, formatter);
  }
  return formatter.format(date);
}
export function dayStart(day: string, zone: string) {
  const target = Date.parse(day);
  let instant = target;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let n = 0; n < 4; n++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = target - local;
    instant += delta;
    if (!delta) break;
  }
  return new Date(instant).toISOString();
}
const validDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const visitorId = (e: any) => e.visitor || 'legacy-' + e.id;
const sessionId = (e: any) => JSON.stringify([visitorId(e), e.session || e.id]);
const byViews = (a: any, b: any) =>
  b.views - a.views ||
  String(a.path || a.name || a.host || '').localeCompare(String(b.path || b.name || b.host || ''));
const joined = `SELECT e.*,c.country,c.browser,c.os,c.device,c.model,c.language,c.channel,c.engine,c.source,c.medium,c.campaign,
  COALESCE(a.active_ms,0) active_ms,COALESCE(a.scroll,0) scroll,a.last_seen,COALESCE(a.closed,0) closed FROM events e
  LEFT JOIN event_context c ON c.event_id=e.id LEFT JOIN page_activity a ON a.view_id=e.id`;
function decorate(row: any) {
  const fallback = referral(row.referrer || '');
  return {
    ...row,
    country: row.country || '',
    browser: row.browser || '未知',
    os: row.os || '未知',
    device: row.device || 'unknown',
    model: row.model || '未知',
    channel: row.channel || fallback.channel,
    engine: row.engine || fallback.engine,
    source: row.source || '',
    medium: row.medium || '',
    campaign: row.campaign || '',
  };
}
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
export function realtimeReport(
  db: Database.Database,
  params = new URLSearchParams(),
  clock = Date.now(),
) {
  const path = params.get('path') ? normalizePath(params.get('path')!) : '';
  const args=[new Date(clock-5*60000).toISOString(),...(path?[path]:[])];
  const from=` FROM page_activity a INDEXED BY activity_open_seen JOIN events e ON e.id=a.view_id LEFT JOIN event_context c ON c.event_id=e.id WHERE a.closed=0 AND a.last_seen>=? AND e.kind='view'${path?' AND e.path=?':''}`;
  const count=(db.prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id)) count"+from).get(...args) as {count:number}).count;
  const rows=db.prepare(`WITH ranked AS(SELECT e.id,e.visitor,e.session,e.path,e.ts,a.last_seen,c.country,c.browser,c.os,c.device,
    ROW_NUMBER() OVER(PARTITION BY COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id) ORDER BY a.last_seen DESC,e.ts,e.id) position${from})
    SELECT * FROM ranked WHERE position=1 ORDER BY last_seen DESC,ts,id LIMIT 100`).all(...args) as any[];
  return {
    count,
    windowMinutes: 5,
    at: new Date(clock).toISOString(),
    visitors: rows.map(decorate).map(row=>({id:visitorId(row),session:row.session,path:row.path,lastSeen:row.last_seen,country:row.country,browser:row.browser,os:row.os,device:row.device})),
  };
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
