import { digest } from '../../packages/core/src/storage.ts';
import type { WordpressStatisticsSnapshot } from '../../packages/core/src/wordpress-statistics.ts';
export function wordpressStatisticsFixture(): WordpressStatisticsSnapshot {
  const tables: any = {
    visitors: [
      {
        id: 1,
        day: '2026-10-28',
        browser: 'Chrome',
        os: 'Windows',
        browserVersion: '134',
        device: 'desktop',
        model: null,
        country: 'CN',
        city: null,
        region: null,
        continent: 'AS',
        referrer: 'chatgpt.com',
        sourceChannel: 'search',
        sourceName: 'ChatGPT',
        hits: 3,
        firstPage: 10,
        firstView: '2026-10-28 10:00:00',
        lastPage: 11,
        lastView: '2026-10-28 10:02:00',
      },
      {
        id: 2,
        day: '2026-10-29',
        browser: 'Mobile Safari',
        os: 'iOS',
        browserVersion: '18',
        device: 'smartphone',
        model: 'Apple iPhone',
        country: 'SG',
        city: null,
        region: null,
        continent: 'AS',
        referrer: '',
        sourceChannel: 'direct',
        sourceName: 'Direct',
        hits: 1,
        firstPage: 12,
        firstView: '2026-10-29 08:00:00',
        lastPage: 12,
        lastView: '2026-10-29 08:00:00',
      },
    ],
    pages: [
      { id: 10, uri: '/first/', type: 'post', day: '2026-10-28', views: 2, objectId: 42 },
      { id: 11, uri: '/missing/?s=中文', type: '404', day: '2026-10-28', views: 1, objectId: 0 },
      { id: 12, uri: '/first/', type: 'post', day: '2026-10-29', views: 1, objectId: 42 },
    ],
    relationships: [
      { id: 20, visitorId: 1, pageId: 10, at: '2026-10-28 10:00:00' },
      { id: 21, visitorId: 1, pageId: 11, at: '2026-10-28 10:02:00' },
      { id: 22, visitorId: 2, pageId: 12, at: '2026-10-29 08:00:00' },
    ],
    daily: [
      { id: 30, day: '2026-04-01', visitors: 15, views: 24 },
      { id: 31, day: '2026-10-28', visitors: 1, views: 3 },
    ],
    historical: [
      { id: 40, category: 'visits', pageId: 0, uri: '', value: 24 },
      { id: 41, category: 'uri', pageId: 42, uri: '/first/', value: 20 },
    ],
    events: [{ id: 50, at: '2026-10-28 10:01:00', pageId: 10, visitorId: 1, name: 'share' }],
  };
  return {
    schema: 'weava-wp-statistics-v1',
    source: {
      siteUrl: 'https://wordpress.example',
      timezone: 'Asia/Shanghai',
      pluginVersion: '14.16.10',
    },
    capturedAt: '2026-10-29T12:00:00+00:00',
    databaseReadOnly: true,
    consistentSnapshot: true,
    missingColumns: {},
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, rows]: any) => [
        name,
        { present: true, count: rows.length, sha256: digest(JSON.stringify(rows)), rows },
      ]),
    ) as WordpressStatisticsSnapshot['tables'],
  };
}
export function sealWordpressStatistics(snapshot: WordpressStatisticsSnapshot) {
  for (const table of Object.values(snapshot.tables)) {
    table.count = table.rows.length;
    table.sha256 = digest(JSON.stringify(table.rows));
  }
  return snapshot;
}
