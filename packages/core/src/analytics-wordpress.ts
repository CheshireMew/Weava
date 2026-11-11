import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import type { AnalyticsReport, AnalyticsVisitor, AnalyticsVisitorDetail } from '../../contracts/src/analytics.ts';
import type { WordpressStatisticsSnapshot } from './wordpress-statistics.ts';
import { normalizePath } from './paths.ts';
import {dayStart,shiftDay} from './analytics-dates.ts';
import { referral, analyticsKnownSourceName, analyticsSourceChannel, analyticsSourceEngine, unrecordedAnalyticsSource } from './analytics-dimensions.ts';

type Rows = WordpressStatisticsSnapshot['tables'];
type Source = { id: string; siteUrl: string; timezone: string; tables: { [K in keyof Rows]: Rows[K]['rows'] }; paths: Map<number, string>; entries: Map<number, string> };
const cached = new WeakMap<Database.Database, { key: string; sources: Source[] }>();
const lifetimes = new WeakMap<Source[], { views: number; visitors: number; pages: Map<string, number>; entries: Map<string, number> }>();
const localDays = new Map<string, number>();
const contexts = new WeakMap<object, ReturnType<typeof visitorContext>>();
const pathOf = (uri: string) => {
  try { return normalizePath(new URL(uri, 'https://weava.invalid').pathname); } catch { return uri; }
};
function sources(db: Database.Database): Source[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='wp_statistics_sources'").get()) return [];
  const active = db.prepare('SELECT s.source_id,s.fingerprint,n.metadata FROM wp_statistics_sources s JOIN wp_statistics_snapshots n USING(fingerprint) ORDER BY s.source_id').all() as any[];
  if (!active.length) return [];
  const content = new Database(join(dirname(db.name), 'weava.sqlite'), { readonly: true });
  let entries: { id: string; path: string }[];
  try { entries = content.prepare("SELECT id,json_extract(summary,'$.path') path FROM entry_list ORDER BY id").all() as typeof entries; }
  finally { content.close(); }
  const key = JSON.stringify([active.map(r => r.fingerprint), entries]);
  const old = cached.get(db); if (old?.key === key) return old.sources;
  const currentPaths = new Map(entries.map(e => [e.id, e.path]));
  const result = active.map(row => {
    const metadata = JSON.parse(row.metadata), tables: any = {};
    for (const table of ['visitors', 'pages', 'relationships', 'daily', 'historical', 'events'])
      tables[table] = (db.prepare('SELECT data FROM wp_statistics_rows WHERE fingerprint=? AND table_name=? ORDER BY row_id').all(row.fingerprint, table) as { data: string }[]).map(r => JSON.parse(r.data));
    const paths = new Map<number, string>(), mappedEntries = new Map<number, string>();
    for (const page of metadata.mapping) {
      paths.set(page.id, currentPaths.get(page.entryId) ?? page.path ?? pathOf(page.uri));
      if (page.entryId) mappedEntries.set(page.id, page.entryId);
    }
    return { id: row.source_id, siteUrl: metadata.source.siteUrl || '', timezone: metadata.source.timezone, tables, paths, entries: mappedEntries } as Source;
  });
  cached.set(db, { key, sources: result }); return result;
}
function identity(source: Source, visitor: number) { return source.id + ':' + visitor; }
function timestamp(at: string, timezone: string) {
  const [day, time] = at.split(' '), [h, m, s] = time.split(':').map(Number);
  const key = timezone + ':' + day;
  let lower = localDays.get(key);
  if (lower === undefined) { lower = Date.parse(dayStart(day, timezone)); if (localDays.size >= 1024) localDays.delete(localDays.keys().next().value!); localDays.set(key, lower); }
  return new Date(lower + (h * 3600 + m * 60 + s) * 1000).toISOString();
}
function visitorContext(v: Rows['visitors']['rows'][number], siteUrl: string) {
  const origin = referral(v.referrer || '', siteUrl);
  const engine = analyticsSourceEngine(origin.engine, v.sourceName || '');
  const channels: Record<string, string> = { direct: 'direct-or-unknown', search: 'search-referral', organic: 'search-referral', social: 'social', referral: 'referral', paid: 'paid', email: 'email' };
  const source = analyticsKnownSourceName(v.sourceName || '', engine, origin.host);
  return { country: v.country || '', browser: v.browser || '未知', os: v.os || '未知', device: v.device || 'unknown', model: v.model || '未知',
    channel: analyticsSourceChannel(channels[v.sourceChannel || ''] || origin.channel, source, origin.host),
    source: source || unrecordedAnalyticsSource,
    host: origin.host || null, engine };
}
function context(v: Rows['visitors']['rows'][number], siteUrl: string) { let result = contexts.get(v); if (!result) { result = visitorContext(v, siteUrl); contexts.set(v, result); } return result; }
function select(source: Source, params: URLSearchParams, start: string, end: string) {
  const inRange = (day: string) => day >= start && day <= end;
  const path = params.get('path') ? normalizePath(params.get('path')!) : '';
  const filtered = ['country', 'browser', 'os', 'device', 'model', 'channel'].some(k => params.has(k));
  const visitors = source.tables.visitors.filter(v => inRange(v.day) && Object.entries(context(v, source.siteUrl)).every(([k, value]) => !params.has(k) || (value || '未知') === params.get(k)));
  const ids = new Set(visitors.map(v => v.id));
  const relations = source.tables.relationships.filter(r => inRange(r.at.slice(0, 10)) && ids.has(r.visitorId) && (!path || source.paths.get(r.pageId) === path));
  const related = new Set(relations.map(r => r.visitorId));
  return { path, filtered, visitors: path ? visitors.filter(v => related.has(v.id)) : visitors, relations,
    pages: source.tables.pages.filter(p => inRange(p.day) && (!path || source.paths.get(p.id) === path)), inRange };
}
function daily(source: Source, params: URLSearchParams, start: string, end: string) {
  const selected = select(source, params, start, end), days = new Map<string, { views: number; visitors: number }>();
  const get = (date: string) => { let row = days.get(date); if (!row) { row = { views: 0, visitors: 0 }; days.set(date, row); } return row; };
  if (selected.path || selected.filtered) {
    if (selected.path) for (const p of selected.pages) get(p.day).views += selected.filtered ? selected.relations.filter(r => r.pageId === p.id).length : p.views;
    else for (const v of selected.visitors) get(v.day).views += v.hits ?? 0;
    for (const v of selected.visitors) get(v.day).visitors++;
  } else {
    for (const p of selected.pages) get(p.day).views += p.views;
    // Visitor hits are the overview's view counter in WP Statistics. Summaries
    // retain dates whose detailed records were purged; never add both layers.
    const hits = new Map<string, number>();
    for (const v of selected.visitors) { get(v.day).visitors++; if (v.hits !== null) hits.set(v.day, (hits.get(v.day) ?? 0) + v.hits); }
    for (const [date, views] of hits) get(date).views = views;
    for (const row of source.tables.daily) if (selected.inRange(row.day)) days.set(row.day, { views: row.views, visitors: row.visitors });
  }
  return days;
}
function totals(source: Source, params: URLSearchParams, start: string, end: string) {
  return [...daily(source, params, start, end).values()].reduce((sum, row) => ({ views: sum.views + row.views, visitors: sum.visitors + row.visitors }), { views: 0, visitors: 0 });
}
function addTotals(target: any, value: { views: number; visitors: number }) {
  target.views += value.views; target.visitors += value.visitors;
  if (value.views || value.visitors) target.sessions = null;
}
const byViews = (a: any, b: any) => b.views - a.views || String(a.path || a.name).localeCompare(String(b.path || b.name));

function lifetimeTotals(active: Source[]) {
  const pages = new Map<string, number>(), entries = new Map<string, number>();
  let views = 0, visitors = 0;
  for (const source of active) {
    const byUri = new Map<string, Rows['pages']['rows'][number]>();
    for (const page of source.tables.pages) {
      const uri = pathOf(page.uri);
      if (!byUri.has(uri)) byUri.set(uri, page);
      const target = source.paths.get(page.id) ?? uri, entry = source.entries.get(page.id);
      pages.set(target, (pages.get(target) ?? 0) + page.views);
      if (entry) entries.set(entry, (entries.get(entry) ?? 0) + page.views);
    }
    for (const row of source.tables.historical.filter(r => r.category === 'uri' && r.uri)) {
      const original = pathOf(row.uri!), page = byUri.get(original);
      const target = page ? source.paths.get(page.id)! : original, entry = page ? source.entries.get(page.id) : undefined;
      pages.set(target, (pages.get(target) ?? 0) + row.value);
      if (entry) entries.set(entry, (entries.get(entry) ?? 0) + row.value);
    }
    views += source.tables.visitors.reduce((n, v) => n + (v.hits ?? 0), 0) + source.tables.historical.filter(r => r.category === 'visits').reduce((n, r) => n + r.value, 0);
    visitors += source.tables.visitors.length + source.tables.historical.filter(r => r.category === 'visitors').reduce((n, r) => n + r.value, 0);
  }
  return { views, visitors, pages, entries };
}
export function wordpressLifetime(db: Database.Database, path?: string) {
  const active = sources(db); if (!active.length) return null;
  const lifetime = lifetimes.get(active) ?? lifetimeTotals(active);
  lifetimes.set(active, lifetime);
  return { ...lifetime,
    ...(path ? { views: lifetime.pages.get(path) ?? 0, visitors: active.reduce((n, source) => n + new Set(source.tables.relationships.filter(r => source.paths.get(r.pageId) === path).map(r => r.visitorId)).size, 0) } : {}),
    pages: new Map(lifetime.pages), entries: new Map(lifetime.entries),
  };
}

/** Imported counts participate in the ordinary report. Raw visits stay out of
 * native events: page aggregates, daily summaries and visit links overlap. */
export function mergeWordpressAnalytics(db: Database.Database, native: AnalyticsReport, params: URLSearchParams): AnalyticsReport {
  const active = sources(db); if (!active.length) return native;
  const report = structuredClone(native), { start, end, previousStart, previousEnd, days } = report.range;
  const pageRows = new Map(report.pages.map(p => [p.path, p])), sourceRows = new Map(report.sources.map(s => [JSON.stringify([s.channel, s.name]), s]));
  const dimensionKeys = { countries: 'country', browsers: 'browser', operatingSystems: 'os', devices: 'device', models: 'model' } as const;
  const dimensions = Object.fromEntries(Object.keys(dimensionKeys).map(k => [k, new Map((report[k as keyof typeof dimensionKeys]).map(r => [r.name, r.visitors]))])) as Record<keyof typeof dimensionKeys, Map<string, number>>;
  let importedViews = 0;
  for (const source of active) {
    const value = totals(source, params, start, end); importedViews += value.views; addTotals(report, value);
    addTotals(report.previous, totals(source, params, previousStart, previousEnd));
    const now = daily(source, params, start, end), before = daily(source, params, previousStart, previousEnd);
    for (const row of report.daily) {
      const value = now.get(row.date), previous = before.get(shiftDay(row.date, -days));
      if (value) { row.views += value.views; row.visitors += value.visitors; if (value.views || value.visitors) row.sessions = null; }
      if (previous) { row.previousViews += previous.views; row.previousVisitors += previous.visitors; }
    }
    const overviewParams = new URLSearchParams(params.get('path') ? { path: params.get('path')! } : {});
    for (const row of report.overview) {
      addTotals(row, totals(source, overviewParams, row.start, row.end));
      const length = Math.round((Date.parse(row.end) - Date.parse(row.start)) / 86400000) + 1;
      addTotals(row.previous, totals(source, overviewParams, shiftDay(row.start, -length), shiftDay(row.start, -1)));
    }
    const selected = select(source, params, start, end), relations = new Map<number, typeof selected.relations>();
    for (const row of selected.relations) { const list = relations.get(row.pageId) ?? []; list.push(row); relations.set(row.pageId, list); }
    const visitorsByPage = new Map<string, Set<number>>();
    for (const page of selected.pages) {
      const path = source.paths.get(page.id) ?? pathOf(page.uri), links = relations.get(page.id) ?? [], views = selected.filtered ? links.length : page.views;
      if (!views) continue;
      let row = pageRows.get(path); if (!row) { row = { path, views: 0, visitors: 0, clicks: 0, entries: 0, exits: 0, activeMs: 0, averageActiveMs: 0 }; pageRows.set(path, row); }
      row.views += views; row.averageActiveMs = null;
      const ids = visitorsByPage.get(path) ?? new Set<number>(); for (const r of links) ids.add(r.visitorId); visitorsByPage.set(path, ids);
    }
    for (const [path, ids] of visitorsByPage) pageRows.get(path)!.visitors += ids.size;
    const relationsByVisitor = new Map<number, typeof selected.relations>();
    for (const row of selected.relations) { const list = relationsByVisitor.get(row.visitorId) ?? []; list.push(row); relationsByVisitor.set(row.visitorId, list); }
    const visitorRows: AnalyticsVisitor[] = selected.visitors.map(v => {
      const info = context(v, source.siteUrl), visits = (relationsByVisitor.get(v.id) ?? []).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
      for (const [key, field] of Object.entries(dimensionKeys)) { const map = dimensions[key as keyof typeof dimensionKeys], name = info[field as keyof typeof info] || '未知'; map.set(name, (map.get(name) ?? 0) + 1); }
      const first = v.firstPage ? source.paths.get(v.firstPage) : undefined, last = v.lastPage ? source.paths.get(v.lastPage) : undefined;
      const entryPath = first || source.paths.get(visits[0]?.pageId) || '', exitPath = last || source.paths.get(visits.at(-1)?.pageId!) || '';
      if (first && pageRows.has(first)) pageRows.get(first)!.entries++;
      if (last && pageRows.has(last)) pageRows.get(last)!.exits++;
      const views = selected.path ? visits.length : v.hits ?? visits.length;
      if (info.source !== unrecordedAnalyticsSource) {
        const key = JSON.stringify([info.channel, info.source]);
        let origin = sourceRows.get(key);
        if (!origin) { origin = { channel: info.channel, host: info.host, name: info.source, views: 0, sessions: null, visitors: 0 }; sourceRows.set(key, origin); }
        if (origin.host !== info.host) origin.host = null;
        origin.views += views;
        origin.visitors++;
        origin.sessions = null;
      }
      return { id: identity(source, v.id), views, sessions: null, firstSeen: timestamp(v.firstView || visits[0]?.at || v.day + ' 00:00:00', source.timezone), lastSeen: timestamp(v.lastView || visits.at(-1)?.at || v.day + ' 00:00:00', source.timezone), entryPath, exitPath, ...info, activeMs: null };
    });
    report.recentVisitors.push(...visitorRows); report.activeVisitors.push(...visitorRows);
    for (const event of source.tables.events.filter(e => selected.inRange(e.at.slice(0, 10)) && (!selected.path || source.paths.get(e.pageId!) === selected.path) && (!selected.filtered || selected.visitors.some(v => v.id === e.visitorId)))) {
      const action = report.actions.find(r => r.name === event.name); if (action) action.count++; else report.actions.push({ name: event.name, count: 1 });
    }
    // Search trends count views for both systems; WP has no session identifiers.
    for (const [lower, upper, previous] of [[start, end, false], [previousStart, previousEnd, true]] as const) {
      const period = select(source, params, lower, upper), hits = new Map<number, number>();
      for (const r of period.relations) hits.set(r.visitorId, (hits.get(r.visitorId) ?? 0) + 1);
      for (const v of period.visitors) {
        const info = context(v, source.siteUrl); if (!info.engine) continue;
        let engine = report.engines.find(e => e.name === info.engine);
        if (!engine) { engine = { name: info.engine, channel: info.channel, sessions: null, views: 0, daily: [], previousSessions: null, previousDaily: [], previousViews: 0 }; report.engines.push(engine); }
        const series = previous ? engine.previousDaily : engine.daily;
        let day = series.find(d => d.date === (previous ? shiftDay(v.day, days) : v.day));
        if (!day) { day = { date: previous ? shiftDay(v.day, days) : v.day, sessions: null, views: 0 }; series.push(day); }
        const views = period.path ? hits.get(v.id) ?? 0 : v.hits ?? 0;
        day.views = (day.views ?? 0) + views; day.sessions = null;
        if (previous) { engine.previousViews = (engine.previousViews ?? 0) + views; engine.previousSessions = null; }
        else { engine.views += views; engine.sessions = null; }
      }
    }
  }
  report.pages = [...pageRows.values()].sort(byViews); report.sources = [...sourceRows.values()].sort(byViews);
  for (const key of Object.keys(dimensionKeys) as (keyof typeof dimensionKeys)[]) {
    const total = [...dimensions[key].values()].reduce((n, v) => n + v, 0);
    report[key] = [...dimensions[key]].map(([name, visitors]) => ({ name, visitors, share: total ? visitors / total : 0 })).sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name));
  }
  report.recentVisitors.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id)); report.recentVisitors = report.recentVisitors.slice(0, 100);
  report.activeVisitors.sort((a, b) => b.views - a.views || a.id.localeCompare(b.id)); report.activeVisitors = report.activeVisitors.slice(0, 100);
  if (importedViews) report.averageActiveMs = null;
  const lifetime = wordpressLifetime(db, params.get('path') ? normalizePath(params.get('path')!) : undefined)!;
  report.lifetime.views += lifetime.views; report.lifetime.visitors += lifetime.visitors; report.lifetime.sessions = null;
  // The Puock theme counter measures the same article population separately.
  // Keep its imported rows, but select WP Statistics as the active baseline.
  const paths = new Map(report.lifetimePages.map(p => [p.path, { ...p, views: p.recordedViews, historicalViews: 0 }]));
  for (const [path, views] of lifetime.pages) {
    if (params.get('path') && path !== normalizePath(params.get('path')!)) continue;
    const row = paths.get(path) ?? { path, views: 0, recordedViews: 0, historicalViews: 0 }; row.historicalViews = views; row.views = row.recordedViews + views; paths.set(path, row);
  }
  report.lifetimePages = [...paths.values()].sort(byViews); report.historicalViews = lifetime.views; report.lifetimeViews = report.lifetime.views;
  return report;
}

export function wordpressVisitor(db: Database.Database, id: string, params: URLSearchParams, timezone: string): AnalyticsVisitorDetail | null {
  const source = sources(db).find(s => id.startsWith(s.id + ':')); if (!source) return null;
  const visitor = source.tables.visitors.find(v => identity(source, v.id) === id); if (!visitor) return null;
  const start = params.get('start')!, end = params.get('end')!, page = Math.max(1, Math.min(1000000, Math.trunc(Number(params.get('page')) || 1))), pageSize = 50;
  const records = [
    ...source.tables.relationships.filter(r => r.visitorId === visitor.id).map(r => ({ ...r, kind: 'view', label: '' })),
    ...source.tables.events.filter(r => r.visitorId === visitor.id).map(r => ({ ...r, kind: 'event', label: r.name })),
  ].filter(r => r.at.slice(0, 10) >= start && r.at.slice(0, 10) <= end && (!params.get('path') || source.paths.get(r.pageId!) === normalizePath(params.get('path')!))).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  return { id, start, end, timezone, page, pageSize, total: records.length, pages: Math.ceil(records.length / pageSize), events: records.slice((page - 1) * pageSize, page * pageSize).map(r => ({ id: id + ':' + r.kind + ':' + r.id, kind: r.kind, ts: timestamp(r.at, source.timezone), path: source.paths.get(r.pageId!) || '', session: '', url: '', label: r.label, zone: '', referrer: visitor.referrer || '', ...context(visitor, source.siteUrl), activeMs: null, scroll: null })) };
}
