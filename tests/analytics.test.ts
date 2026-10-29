import { describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Analytics } from '@weava/core';
import { deviceInfo, referral } from '../packages/core/src/analytics-dimensions.ts';
import { dayStart, analyticsReport } from '../packages/core/src/analytics-reports.ts';

const root = 'D:/Tools/cache/weava/tests/analytics-' + Date.now();
const windows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
function fixture(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return new Analytics(dir);
}
function record(a: Analytics, overrides: Record<string, any> = {}, agent = windows) {
  const event = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind: 'view',
    path: '/one/',
    visitor: 'visitor-a',
    session: 'session-a',
    ...overrides,
  };
  a.collect(event, agent, new Set(['/one/', '/two/', '/中文/']), {
    origin: 'https://example.com',
    ip: '8.8.8.8',
  });
  return event;
}
function historical(
  a: Analytics,
  id: string,
  path: string,
  ts: string,
  visitor = 'reader',
  session = 'session',
) {
  a.raw
    .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'view', ts, path, visitor, session, '', '', '', '', 'release');
}
describe('complete analytics', () => {
  it('attributes internal navigation to the entry source and counts sessions separately from page views', () => {
    const a = fixture('source');
    try {
      vi.spyOn(a.geo, 'country').mockReturnValue('US');
      const first = record(a, {
        referrer: 'https://chatgpt.com/',
        campaign: { source: 'assistant', medium: 'referral', campaign: 'launch' },
      });
      record(a, {
        path: '/two/',
        referrer: 'https://example.com/one/',
        ts: new Date(Date.now() + 1000).toISOString(),
      });
      record(
        a,
        {
          visitor: 'visitor-b',
          session: 'session-b',
          referrer: 'https://www.google.com/search?q=one',
        },
        iphone,
      );
      const report = a.report(new URLSearchParams());
      expect(report).toMatchObject({ views: 3, visitors: 2, sessions: 2, clicks: 0 });
      expect(report.sources.find((s) => s.channel === 'ai-referral')).toMatchObject({
        views: 2,
        sessions: 1,
        visitors: 1,
      });
      expect(report.sources.some((s) => s.host === 'example.com')).toBe(false);
      expect(report.engines.find((s) => s.name === 'ChatGPT')?.sessions).toBe(1);
      expect(report.devices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'desktop', visitors: 1 }),
          expect.objectContaining({ name: 'smartphone', visitors: 1 }),
        ]),
      );
      expect(report.models.find((r) => r.name === 'Apple iPhone')?.visitors).toBe(1);
      expect(report.countries).toEqual([{ name: 'US', visitors: 2, share: 1 }]);
      expect(report.pages.find((p) => p.path === '/one/')?.entries).toBe(2);
      expect(report.pages.find((p) => p.path === '/two/')?.exits).toBe(1);
      expect(
        a.report(new URLSearchParams({ channel: 'ai-referral', device: 'desktop' })).views,
      ).toBe(2);
      expect(a.report(new URLSearchParams({ model: 'Apple iPhone' })).views).toBe(1);
      expect(a.visitor(first.visitor).events).toHaveLength(2);
    } finally {
      a.close();
    }
  });
  it('updates visible dwell and online state idempotently without inventing views', () => {
    const a = fixture('pulse');
    try {
      const ts = new Date(Date.now() - 60000).toISOString(),
        view = record(a, { ts });
      const pulse = {
        ...view,
        id: crypto.randomUUID(),
        kind: 'pulse',
        viewId: view.id,
        ts: new Date().toISOString(),
        activeMs: 30000,
        scroll: 75,
      };
      expect(a.collect(pulse, windows, new Set(['/one/'])).accepted).toBe(1);
      a.collect(pulse, windows, new Set(['/one/']));
      let report = a.report(new URLSearchParams());
      expect(report.views).toBe(1);
      expect(report.averageActiveMs).toBe(30000);
      expect(report.realtime.count).toBe(1);
      a.collect(
        {
          ...pulse,
          id: crypto.randomUUID(),
          closed: true,
          activeMs: 40000,
          ts: new Date(Date.now() + 10).toISOString(),
        },
        windows,
        new Set(['/one/']),
      );
      expect(a.realtime().count).toBe(0);
      // Delayed older packets must not reopen a closed page or reduce dwell/scroll.
      a.collect(
        { ...pulse, id: crypto.randomUUID(), activeMs: 1000, scroll: 10 },
        windows,
        new Set(['/one/']),
      );
      expect(a.realtime().count).toBe(0);
      expect(a.visitor(view.visitor).events[0]).toMatchObject({ activeMs: 40000, scroll: 75 });
      expect(
        a.collect({ ...pulse, visitor: 'someone-else' }, windows, new Set(['/one/'])).accepted,
      ).toBe(0);
      expect(
        a.collect(
          { ...view, id: crypto.randomUUID(), path: '/private/' },
          windows,
          new Set(['/one/']),
        ).accepted,
      ).toBe(0);
      expect(
        a.collect({ ...view, id: crypto.randomUUID() }, 'Googlebot', new Set(['/one/'])).accepted,
      ).toBe(0);
    } finally {
      a.close();
    }
  });
  it('handles dense dates, comparison, timezone boundaries and sessions crossing the range', () => {
    const a = fixture('dates');
    try {
      historical(a, 'a-old', '/one/', '2026-10-27T15:59:00.000Z');
      historical(a, 'b-new', '/two/', '2026-10-27T16:01:00.000Z');
      historical(a, 'c-new', '/one/', '2026-10-28T15:59:59.999Z', 'second', 'second-session');
      historical(a, 'd-next', '/two/', '2026-10-28T16:00:00.000Z', 'third', 'third-session');
      const report = a.report(
        new URLSearchParams({ start: '2026-10-28', end: '2026-10-28' }),
        'Asia/Shanghai',
      );
      expect(report).toMatchObject({ views: 2, visitors: 2, sessions: 2, previous: { views: 1 } });
      expect(report.daily).toMatchObject([{ date: '2026-10-28', views: 2, previousViews: 1 }]);
      expect(report.pages.find((p) => p.path === '/two/')?.entries).toBe(0);
      const range = a.report(new URLSearchParams({ start: '2026-10-25', end: '2026-10-28' }));
      expect(range.daily).toHaveLength(4);
      expect(range.daily[0].views).toBe(0);
      expect(dayStart('2026-03-09', 'America/New_York')).toBe('2026-03-09T04:00:00.000Z');
      expect(dayStart('2026-11-02', 'America/New_York')).toBe('2026-11-02T05:00:00.000Z');
      expect(() =>
        a.report(new URLSearchParams({ start: '2026-02-30', end: '2026-03-01' })),
      ).toThrow(/日期范围/);
      expect(() =>
        a.report(new URLSearchParams({ start: '1900-01-01', end: '2026-01-01' })),
      ).toThrow(/十年/);
    } finally {
      a.close();
    }
  });
  it('upgrades the old event schema and keeps missing dimensions unknown', () => {
    const dir = join(root, 'legacy');
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, 'analytics.sqlite'));
    db.exec(
      'CREATE TABLE events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,release_id TEXT NOT NULL)',
    );
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      'old-view',
      'view',
      new Date().toISOString(),
      '/one/',
      'reader',
      'session',
      '',
      '',
      '',
      'google.com',
      'legacy',
    );
    db.close();
    const a = new Analytics(dir);
    try {
      const r = a.report(new URLSearchParams());
      expect(r.views).toBe(1);
      expect(r.countries[0].name).toBe('未知');
      expect(r.browsers[0].name).toBe('未知');
      expect(r.engines[0].name).toBe('Google');
      expect(r.realtime.count).toBe(0);
      expect(a.raw.prepare('PRAGMA table_info(events)').all()).toHaveLength(11);
      expect(a.report(new URLSearchParams({ country: '未知' })).views).toBe(1);
    } finally {
      a.close();
    }
  });
  it('provides filtered exports and paginated visitor activity including actions', () => {
    const a = fixture('export');
    try {
      for (let i = 0; i < 55; i++)
        record(a, {
          kind: i % 2 ? 'event' : 'view',
          label: i % 2 ? 'share:success' : '',
          path: i % 2 ? '/two/' : '/one/',
        });
      const detail = a.visitor('visitor-a', new URLSearchParams({ page: '2' }));
      expect(detail).toMatchObject({ total: 55, pages: 2, page: 2 });
      expect(detail.events).toHaveLength(5);
      const csv = a.export(new URLSearchParams({ path: '/two/', dataset: 'actions' }));
      expect(csv).toContain('share:success');
      expect(csv).toContain('27');
      expect(a.export(new URLSearchParams({ dataset: 'countries' }))).toContain('未知');
      expect(() => a.export(new URLSearchParams({ dataset: 'raw-credentials' }))).toThrow(/不存在/);
      expect(a.report(new URLSearchParams({ path: '/two/' })).clicks).toBe(0);
    } finally {
      a.close();
    }
  });
  it('expires online pages after five minutes, deduplicates tabs and respects path selection', () => {
    const a = fixture('online');
    try {
      record(a, { ts: new Date(Date.now() - 6 * 60000).toISOString() });
      expect(a.realtime().count).toBe(0);
      record(a, { path: '/two/' });
      record(a, { path: '/two/' });
      expect(a.realtime().count).toBe(1);
      expect(a.realtime(new URLSearchParams({ path: '/one/' })).count).toBe(0);
    } finally {
      a.close();
    }
  });
});
describe('analytics enrichment', () => {
  it('distinguishes AI, search, social, paid, same-site and unknown sources without lookalike matching', () => {
    expect(referral('https://chatgpt.com/').engine).toBe('ChatGPT');
    expect(referral('https://google.com.evil.example/').channel).toBe('referral');
    expect(referral('https://www.google.com.hk/').engine).toBe('Google');
    expect(referral('https://cn.bing.com/').engine).toBe('Bing');
    expect(referral('https://t.co/abc').channel).toBe('social');
    expect(referral('https://example.com/page', 'https://example.com').channel).toBe(
      'direct-or-unknown',
    );
    expect(referral('', '', { source: 'newsletter', medium: 'email' }).channel).toBe('email');
    expect(referral('https://google.com/', '', { medium: 'cpc' }).channel).toBe('paid');
  });
  it('uses established UA parsing and an explicit iPad hint rather than guessed phone models', () => {
    expect(deviceInfo(windows)).toMatchObject({
      browser: 'Chrome',
      os: 'Windows',
      device: 'desktop',
      model: '未知',
    });
    expect(deviceInfo(iphone)).toMatchObject({
      os: 'iOS',
      device: 'smartphone',
      model: 'Apple iPhone',
    });
    expect(
      deviceInfo(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
        { touchPoints: 5 },
      ),
    ).toMatchObject({ os: 'iOS', device: 'tablet' });
  });
  it('keeps failures visible while preserving an existing local geo database', async () => {
    const a = fixture('geo-error');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }));
    try {
      await expect(a.geo.update()).rejects.toThrow(/503/);
      expect(a.geo.status()).toMatchObject({
        available: false,
        updating: false,
        error: '地区库下载失败：HTTP 503',
      });
      expect(a.geo.country('127.0.0.1')).toBe('');
      expect(a.geo.country('not-an-ip')).toBe('');
    } finally {
      fetch.mockRestore();
      a.close();
    }
  });
});
