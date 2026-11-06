import * as z from 'zod';
import { resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { normalizePath } from '../paths.ts';
import { referral } from '../analytics-dimensions.ts';
import { database, hasHistory, activeSource, pagePath } from './store.ts';
import { WordpressStatisticsTable, day, page, visitor, relationship, daily } from './format.ts';

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
