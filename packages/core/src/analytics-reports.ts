import type Database from 'better-sqlite3';
import { WeavaError } from '@weava/contracts';
import { normalizePath } from './site.ts';
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
  const rows = (
    db
      .prepare(
        joined +
          ` WHERE e.kind='view' AND a.last_seen>=? AND a.closed=0` +
          (path ? ' AND e.path=?' : '') +
          ' ORDER BY a.last_seen DESC',
      )
      .all(new Date(clock - 5 * 60000).toISOString(), ...(path ? [path] : [])) as any[]
  ).map(decorate);
  const visitors = new Map<string, any>();
  for (const row of rows)
    if (!visitors.has(visitorId(row)))
      visitors.set(visitorId(row), {
        id: visitorId(row),
        session: row.session,
        path: row.path,
        lastSeen: row.last_seen,
        country: row.country,
        browser: row.browser,
        os: row.os,
        device: row.device,
      });
  return {
    count: visitors.size,
    windowMinutes: 5,
    at: new Date(clock).toISOString(),
    visitors: [...visitors.values()].slice(0, 100),
  };
}
export function analyticsReport(
  db: Database.Database,
  params: URLSearchParams,
  timezone: string,
  clock = Date.now(),
) {
  const today = dayInZone(new Date(clock), timezone);
  const start = params.get('start') || shiftDay(today, -29),
    end = params.get('end') || today;
  if (
    !validDay(start) ||
    !validDay(end) ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / dayMs > 3660
  )
    throw new WeavaError('日期范围无效，请选择不超过十年的有效日期。');
  const days = Math.round((Date.parse(end) - Date.parse(start)) / dayMs) + 1;
  const previousStart = shiftDay(start, -days),
    previousEnd = shiftDay(start, -1);
  const path = params.get('path') ? normalizePath(params.get('path')!) : '';
  const lower = dayStart(previousStart, timezone),
    current = dayStart(start, timezone),
    upper = dayStart(shiftDay(end, 1), timezone);
  const ranged = (
    db.prepare(joined + ' WHERE e.ts>=? AND e.ts<? ORDER BY e.ts,e.id').all(lower, upper) as any[]
  ).map(decorate);
  // Attribute every page in a session to its actual first view, including sessions crossing midnight.
  const related = (
    db
      .prepare(
        joined +
          ` JOIN (SELECT DISTINCT visitor,session FROM events WHERE kind='view' AND ts>=? AND ts<?) selected
    ON selected.visitor=e.visitor AND selected.session=e.session WHERE e.kind='view' ORDER BY e.ts,e.id`,
      )
      .all(lower, upper) as any[]
  ).map(decorate);
  const sessions = viewSessions(related);
  const matches = (row: any) => {
    const origin = sessions.get(sessionId(row))?.[0] || row;
    return (
      (!path || row.path === path) &&
      ['country', 'browser', 'os', 'device', 'model'].every(
        (key) => !params.get(key) || (row[key] || '未知') === params.get(key),
      ) &&
      (!params.get('channel') || origin.channel === params.get('channel'))
    );
  };
  const selected = ranged.filter((e) => e.ts >= current && matches(e));
  const previous = ranged.filter((e) => e.ts < current && matches(e));
  const views = selected.filter((e) => e.kind === 'view'),
    totals = summary(selected);
  const pages = new Map<string, any>(),
    daily = new Map<string, any>(),
    links = new Map<string, any>(),
    sources = new Map<string, any>(),
    engines = new Map<string, any>(),
    actions = new Map<string, number>();
  const dailyVisitors = new Map<string, Set<string>>(),
    dailySessions = new Map<string, Set<string>>();
  for (let offset = 0; offset < days; offset++) {
    const date = shiftDay(start, offset);
    daily.set(date, {
      date,
      views: 0,
      visitors: 0,
      sessions: 0,
      clicks: 0,
      previousViews: 0,
      previousVisitors: 0,
    });
  }
  for (const ev of previous.filter((e) => e.kind === 'view')) {
    const key = shiftDay(dayInZone(new Date(ev.ts), timezone), days),
      d = daily.get(key);
    if (d) {
      d.previousViews++;
      const set = dailyVisitors.get('prev' + key) || new Set<string>();
      set.add(visitorId(ev));
      dailyVisitors.set('prev' + key, set);
      d.previousVisitors = set.size;
    }
  }
  const page = (path: string) => {
    if (!pages.has(path))
      pages.set(path, {
        path,
        views: 0,
        visitors: 0,
        clicks: 0,
        entries: 0,
        exits: 0,
        activeMs: 0,
        averageActiveMs: 0,
      });
    return pages.get(path);
  };
  const pageVisitors = new Map<string, Set<string>>();
  const selectedSessions = viewSessions(views);
  for (const ev of selected) {
    const p = page(ev.path),
      date = dayInZone(new Date(ev.ts), timezone),
      d = daily.get(date);
    if (ev.kind === 'view') {
      p.views++;
      p.activeMs += ev.active_ms;
      const pv = pageVisitors.get(ev.path) || new Set<string>();
      pv.add(visitorId(ev));
      pageVisitors.set(ev.path, pv);
      p.visitors = pv.size;
      if (d) {
        d.views++;
        const v = dailyVisitors.get(date) || new Set<string>();
        v.add(visitorId(ev));
        dailyVisitors.set(date, v);
        d.visitors = v.size;
        const s = dailySessions.get(date) || new Set<string>();
        s.add(sessionId(ev));
        dailySessions.set(date, s);
        d.sessions = s.size;
      }
    } else if (ev.kind === 'click') {
      p.clicks++;
      if (d) d.clicks++;
      const key = JSON.stringify([ev.path, ev.url, ev.zone, ev.label]),
        l = links.get(key) || {
          path: ev.path,
          url: ev.url,
          zone: ev.zone,
          label: ev.label,
          clicks: 0,
        };
      l.clicks++;
      links.set(key, l);
    } else if (ev.kind === 'event') actions.set(ev.label, (actions.get(ev.label) || 0) + 1);
  }
  for (const p of pages.values())
    p.averageActiveMs = p.views ? Math.round(p.activeMs / p.views) : 0;
  const sourceVisitors = new Map<string, Set<string>>();
  const campaigns = new Map<string, any>();
  for (const [key, selectedViews] of selectedSessions) {
    const all = sessions.get(key) || selectedViews,
      first = all[0],
      last = all[all.length - 1];
    if (first.ts >= current && first.ts < upper && matches(first)) page(first.path).entries++;
    if (last.ts >= current && last.ts < upper && matches(last)) page(last.path).exits++;
    const sk = JSON.stringify([
      first.channel,
      first.referrer,
      first.source,
      first.medium,
      first.campaign,
    ]);
    const s = sources.get(sk) || {
      channel: first.channel,
      host: first.referrer || null,
      name: first.source || first.engine || first.referrer || '直接 / 未知',
      views: 0,
      sessions: 0,
      visitors: 0,
    };
    s.views += selectedViews.length;
    s.sessions++;
    const sv = sourceVisitors.get(sk) || new Set<string>();
    sv.add(visitorId(first));
    sourceVisitors.set(sk, sv);
    s.visitors = sv.size;
    sources.set(sk, s);
    if (first.engine) {
      const eg = engines.get(first.engine) || {
        name: first.engine,
        channel: first.channel,
        sessions: 0,
        views: 0,
        daily: new Map<string, number>(),
        previousSessions: 0,
        previousDaily: new Map<string, number>(),
      };
      eg.sessions++;
      eg.views += selectedViews.length;
      const date = dayInZone(new Date(selectedViews[0].ts), timezone);
      eg.daily.set(date, (eg.daily.get(date) || 0) + 1);
      engines.set(first.engine, eg);
    }
    if (first.source || first.campaign) {
      const ck = JSON.stringify([first.source, first.medium, first.campaign]);
      const c = campaigns.get(ck) || {
        source: first.source,
        medium: first.medium,
        campaign: first.campaign,
        sessions: 0,
        views: 0,
      };
      c.sessions++;
      c.views += selectedViews.length;
      campaigns.set(ck, c);
    }
  }
  for (const [key, previousViews] of viewSessions(previous.filter((e) => e.kind === 'view'))) {
    const first = (sessions.get(key) || previousViews)[0];
    if (!first.engine) continue;
    const engine = engines.get(first.engine) || {
      name: first.engine,
      channel: first.channel,
      sessions: 0,
      views: 0,
      daily: new Map<string, number>(),
      previousSessions: 0,
      previousDaily: new Map<string, number>(),
    };
    engine.previousSessions++;
    const aligned = shiftDay(dayInZone(new Date(previousViews[0].ts), timezone), days);
    engine.previousDaily.set(aligned, (engine.previousDaily.get(aligned) || 0) + 1);
    engines.set(first.engine, engine);
  }
  const recent = new Map<string, any>();
  for (const ev of views) {
    const id = visitorId(ev),
      key = sessionId(ev),
      all = sessions.get(key) || [ev];
    let v = recent.get(id);
    if (!v) {
      v = {
        id,
        views: 0,
        sessions: 0,
        firstSeen: ev.ts,
        lastSeen: ev.ts,
        entryPath: all[0].path,
        exitPath: ev.path,
        country: ev.country,
        browser: ev.browser,
        os: ev.os,
        device: ev.device,
        model: ev.model,
        channel: all[0].channel,
        source: all[0].source || all[0].engine || all[0].referrer || '直接 / 未知',
        activeMs: 0,
        _sessions: new Set<string>(),
      };
      recent.set(id, v);
    }
    v.views++;
    v._sessions.add(key);
    v.sessions = v._sessions.size;
    v.activeMs += ev.active_ms;
    v.lastSeen = ev.ts;
    v.entryPath = all[0].path;
    v.channel = all[0].channel;
    v.source = all[0].source || all[0].engine || all[0].referrer || '直接 / 未知';
    v.exitPath = all[all.length - 1].path;
    for (const k of ['country', 'browser', 'os', 'device', 'model']) v[k] = ev[k];
  }
  const visitorRows = [...recent.values()].map(({ _sessions, ...v }) => v);
  const dimension = (key: string) => {
    const counts = new Map<string, number>();
    for (const v of visitorRows) {
      const name = v[key] || '未知';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts]
      .map(([name, visitors]) => ({
        name,
        visitors,
        share: totals.visitors ? visitors / totals.visitors : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name));
  };
  const aggregate = `SELECT COALESCE(SUM(kind='view'),0) views,COALESCE(SUM(kind='click'),0) clicks,
    COUNT(DISTINCT CASE WHEN kind='view' THEN COALESCE(NULLIF(visitor,''),id) END) visitors,
    COUNT(DISTINCT CASE WHEN kind='view' THEN json_array(COALESCE(NULLIF(visitor,''),id),COALESCE(NULLIF(session,''),id)) END) sessions FROM events`;
  const metrics = (a: string, b: string) =>
    db
      .prepare(aggregate + ' WHERE ts>=? AND ts<?' + (path ? ' AND path=?' : ''))
      .get(dayStart(a, timezone), dayStart(shiftDay(b, 1), timezone), ...(path ? [path] : [])) as {
      views: number;
      visitors: number;
      sessions: number;
      clicks: number;
    };
  const overview = [
    { name: '今天', start: today, end: today },
    { name: '昨天', start: shiftDay(today, -1), end: shiftDay(today, -1) },
    { name: '近 7 天', start: shiftDay(today, -6), end: today },
    { name: '近 30 天', start: shiftDay(today, -29), end: today },
  ].map((p) => {
    const span = Math.round((Date.parse(p.end) - Date.parse(p.start)) / dayMs) + 1;
    return {
      ...p,
      ...metrics(p.start, p.end),
      previous: metrics(shiftDay(p.start, -span), shiftDay(p.start, -1)),
    };
  });
  const lifetime = db
    .prepare(aggregate + (path ? ' WHERE path=?' : ''))
    .get(...(path ? [path] : [])) as {
    views: number;
    visitors: number;
    sessions: number;
    clicks: number;
  };
  const crawlerRows = db
    .prepare(
      'SELECT agent,path,status,COUNT(*) requests FROM crawler_requests WHERE ts>=? AND ts<?' +
        (path ? ' AND path=?' : '') +
        ' GROUP BY agent,path,status ORDER BY requests DESC',
    )
    .all(current, upper, ...(path ? [path] : [])) as any[];
  return {
    ...totals,
    range: { start, end, previousStart, previousEnd, days, timezone },
    previous: summary(previous),
    overview,
    lifetime,
    averageActiveMs: views.length
      ? Math.round(views.reduce((sum, v) => sum + v.active_ms, 0) / views.length)
      : 0,
    pages: [...pages.values()].sort(byViews),
    daily: [...daily.values()],
    links: [...links.values()].sort((a, b) => b.clicks - a.clicks),
    sources: [...sources.values()].sort(byViews),
    engines: [...engines.values()].map(({ daily, previousDaily, ...e }) => ({
      ...e,
      daily: [...daily].map(([date, sessions]) => ({ date, sessions })),
      previousDaily: [...previousDaily].map(([date, sessions]) => ({ date, sessions })),
    })),
    campaigns: [...campaigns.values()].sort(byViews),
    countries: dimension('country'),
    browsers: dimension('browser'),
    operatingSystems: dimension('os'),
    devices: dimension('device'),
    models: dimension('model'),
    recentVisitors: visitorRows.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 100),
    activeVisitors: [...visitorRows].sort(byViews).slice(0, 100),
    actions: [...actions].map(([name, count]) => ({ name, count })),
    crawlers: crawlerRows.map((row) => ({ ...row, identity: 'declared-user-agent' })),
    legacySources: db.prepare('SELECT id,path FROM legacy_sources').all(),
    realtime: realtimeReport(db, new URLSearchParams(path ? { path } : {}), clock),
  };
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
