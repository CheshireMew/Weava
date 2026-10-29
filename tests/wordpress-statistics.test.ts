import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  Site,
  Analytics,
  digest,
  parseWordpressStatistics,
  readWordpressStatistics,
  extractWordpressStatistics,
  inspectWordpressStatistics,
  planWordpressStatistics,
  importWordpressStatistics,
  wordpressStatisticsSources,
  wordpressStatisticsReport,
  wordpressStatisticsExportScript,
  writeWordpressStatisticsExportScript,
  verifyWordpressStatistics,
} from '@weava/core';
import { entrySchema } from '@weava/contracts';
import {
  wordpressStatisticsFixture,
  sealWordpressStatistics,
} from './fixtures/wordpress-statistics.ts';
const base = 'D:/Tools/cache/weava/tests/wp-statistics-' + Date.now();
function fixture(name: string) {
  const root = join(base, name),
    site = new Site(root);
  site.saveType(
    { id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' },
    null,
  );
  site.saveEntry(
    entrySchema.parse({
      id: 'wp-post-42',
      kind: 'content',
      title: '现有文章',
      path: '/changed/',
      status: 'published',
      source: {
        system: 'wordpress',
        format: 'wxr',
        id: '42',
        originalUrl: 'https://wordpress.example/first/',
      },
    }),
    null,
  );
  site.publish();
  site.close();
  const a = new Analytics(root);
  a.importViewTotals({
    sourceId: 'puock',
    capturedAt: '2026-01-01T00:00:00Z',
    entries: [{ entryId: 'wp-post-42', path: '/changed/', views: 99 }],
  });
  a.collect(
    {
      id: 'native-view-12345',
      kind: 'view',
      ts: new Date().toISOString(),
      path: '/changed/',
      visitor: 'native',
      session: 'native',
    },
    'Chrome',
    new Set(['/changed/']),
  );
  a.close();
  const input = join(base, name + '-source.json');
  writeFileSync(input, JSON.stringify(wordpressStatisticsFixture()));
  return { root, input };
}
function counts(root: string) {
  const db = new Database(join(root, 'analytics.sqlite'), { readonly: true });
  try {
    return {
      events: db.prepare('SELECT * FROM events').all(),
      historical: db.prepare('SELECT * FROM historical_views').all(),
    };
  } finally {
    db.close();
  }
}
describe('WP Statistics migration tools', () => {
  it('validates all source checksums, relationships, dates and optional empty tables', () => {
    const raw = wordpressStatisticsFixture();
    expect(inspectWordpressStatistics(parseWordpressStatistics(raw)).totals).toMatchObject({
      dailyViews: 27,
      pageViews: 4,
      visitorHits: 4,
    });
    const corrupt = structuredClone(raw);
    corrupt.tables.pages.rows[0].views++;
    expect(() => parseWordpressStatistics(corrupt)).toThrow(/校验/);
    const orphan = structuredClone(raw);
    orphan.tables.relationships.rows[0].visitorId = 999;
    expect(() => parseWordpressStatistics(sealWordpressStatistics(orphan))).toThrow(/关联/);
    const badDate = structuredClone(raw);
    badDate.tables.visitors.rows[0].day = '2026-02-30';
    expect(() => parseWordpressStatistics(sealWordpressStatistics(badDate))).toThrow(/格式/);
    const duplicate = structuredClone(raw);
    duplicate.tables.daily.rows[1].day = duplicate.tables.daily.rows[0].day;
    expect(() => parseWordpressStatistics(sealWordpressStatistics(duplicate))).toThrow(/日期重复/);
    const absent = structuredClone(raw);
    absent.tables.events = { present: false, count: 0, sha256: digest('[]'), rows: [] };
    expect(parseWordpressStatistics(absent).tables.events.present).toBe(false);
    const leaked: any = structuredClone(raw);
    leaked.tables.visitors.rows[0].ip = '127.0.0.1';
    expect(() => parseWordpressStatistics(sealWordpressStatistics(leaked))).toThrow(/格式/);
  });
  it('unwraps server-ops responses and refuses failed/truncated exports and overwrite', () => {
    mkdirSync(base, { recursive: true });
    const input = join(base, 'response.json'),
      output = join(base, 'extracted.json');
    writeFileSync(
      input,
      JSON.stringify({
        exit_code: 0,
        stdout: JSON.stringify(wordpressStatisticsFixture()),
        stderr: '',
      }),
    );
    expect(extractWordpressStatistics(input, output).counts.visitors).toBe(2);
    expect(readWordpressStatistics(output).tables.relationships.count).toBe(3);
    expect(() => extractWordpressStatistics(input, output)).toThrow();
    writeFileSync(input, JSON.stringify({ exit_code: 1, stdout: '{}' }));
    expect(() => readWordpressStatistics(input)).toThrow(/未成功/);
    writeFileSync(input, JSON.stringify({ exit_code: 0, stdout: '{"schema":' }));
    expect(() => readWordpressStatistics(input)).toThrow(/不完整/);
  });
  it('preflights without writes and imports atomically with backup, mappings and source separation', async () => {
    const { root, input } = fixture('basic'),
      contentBefore = digest(readFileSync(join(root, 'weava.sqlite'))),
      before = counts(root),
      analyticsBefore = digest(readFileSync(join(root, 'analytics.sqlite')));
    const plan = planWordpressStatistics(input, root);
    expect(plan.action).toBe('import');
    expect(plan.mapping).toMatchObject({ matched: 2, total: 3 });
    expect(plan.mapping.unmatched).toEqual(['/missing/?s=中文']);
    expect(digest(readFileSync(join(root, 'analytics.sqlite')))).toBe(analyticsBefore);
    expect(digest(readFileSync(join(root, 'weava.sqlite')))).toBe(contentBefore);
    expect(existsSync(join(root, 'imports', 'wp-statistics'))).toBe(false);
    const result = await importWordpressStatistics(input, root, plan.review);
    expect(result.changed).toBe(true);
    expect(existsSync(result.backup!)).toBe(true);
    expect(counts(root)).toEqual(before);
    expect(digest(readFileSync(join(root, 'weava.sqlite')))).toBe(contentBefore);
    const backup = new Database(result.backup!, { readonly: true });
    try {
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(backup.prepare('SELECT COUNT(*) count FROM events').get()).toEqual({ count: 1 });
      expect(
        backup.prepare("SELECT name FROM sqlite_master WHERE name='wp_statistics_sources'").get(),
      ).toBeUndefined();
    } finally {
      backup.close();
    }
    const replayPlan = planWordpressStatistics(input, root),
      replay = await importWordpressStatistics(input, root, replayPlan.review);
    expect(replay.changed).toBe(false);
    expect(replay.backup).toBeNull();
    const db = new Database(join(root, 'analytics.sqlite'), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) count FROM wp_statistics_rows').get()).toEqual({
        count: 13,
      });
      expect(
        db.prepare('SELECT entry_id FROM wp_statistics_page_map WHERE page_id=10').get(),
      ).toEqual({ entry_id: 'wp-post-42' });
    } finally {
      db.close();
    }
    expect(wordpressStatisticsSources(root)).toHaveLength(1);
    expect(verifyWordpressStatistics(root).ok).toBe(true);
    const report = wordpressStatisticsReport(root);
    expect(report.totals).toMatchObject({
      pageAggregateViews: 4,
      dailySummaryViews: 27,
      relationshipRecords: 3,
      visitorRecords: 2,
      uniqueVisitors: null,
      sessions: null,
      activeMs: null,
    });
    expect(report.daily.find((r) => r.day === '2026-10-28')).toMatchObject({
      views: 3,
      visitors: 1,
      basis: 'daily-summary',
    });
    expect(report.daily.find((r) => r.day === '2026-10-29')).toMatchObject({
      views: 1,
      visitors: null,
      basis: 'page-aggregates',
    });
    expect(
      wordpressStatisticsReport(root, new URLSearchParams({ visitor: '1' })).activity.items.map(
        (r) => r.uri,
      ),
    ).toEqual(['/missing/?s=中文', '/first/']);
    expect(
      wordpressStatisticsReport(root, new URLSearchParams({ path: '/first/' })).totals,
    ).toMatchObject({ pageAggregateViews: 3, relationshipRecords: 2, dailySummaryViews: null });
  });
  it('rejects stale reviews and older snapshots, preserves prior generations and makes newer snapshots replace rather than add', async () => {
    const { root, input } = fixture('updates');
    let plan = planWordpressStatistics(input, root);
    await importWordpressStatistics(input, root, plan.review);
    const updated = wordpressStatisticsFixture();
    updated.capturedAt = '2026-10-30T00:00:00Z';
    updated.tables.pages.rows[0].views = 9;
    writeFileSync(input, JSON.stringify(sealWordpressStatistics(updated)));
    await expect(importWordpressStatistics(input, root, plan.review)).rejects.toThrow(/预检/);
    plan = planWordpressStatistics(input, root);
    expect(plan.action).toBe('replace-source-snapshot');
    await importWordpressStatistics(input, root, plan.review);
    expect(wordpressStatisticsReport(root).totals.pageAggregateViews).toBe(11);
    const db = new Database(join(root, 'analytics.sqlite'), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) count FROM wp_statistics_snapshots').get()).toEqual({
        count: 2,
      });
    } finally {
      db.close();
    }
    writeFileSync(input, JSON.stringify(wordpressStatisticsFixture()));
    expect(() => planWordpressStatistics(input, root)).toThrow(/快照/);
    updated.capturedAt = '2026-10-31T00:00:00Z';
    writeFileSync(input, JSON.stringify(updated));
    expect(planWordpressStatistics(input, root).action).toBe('unchanged');
    expect(readdirSync(join(root, 'imports', 'wp-statistics'))).toHaveLength(2);
  });
  it('rejects applying a review when target content mappings changed and refuses a running target', async () => {
    const { root, input } = fixture('mapping-change'),
      plan = planWordpressStatistics(input, root),
      site = new Site(root),
      record = site.store.get('entry', 'wp-post-42')!;
    site.saveEntry({ ...record.value, path: '/different/' }, record.revision);
    site.close();
    await expect(importWordpressStatistics(input, root, plan.review)).rejects.toThrow(/预检/);
    const next = planWordpressStatistics(input, root);
    writeFileSync(
      join(root, 'runtime.json'),
      JSON.stringify({ status: 'running', pid: process.pid }),
    );
    await expect(importWordpressStatistics(input, root, next.review)).rejects.toThrow(
      /服务仍在运行/,
    );
    expect(existsSync(join(root, 'imports', 'wp-statistics'))).toBe(false);
  });
  it('rolls back a partially attempted database transaction and keeps recovery materials', async () => {
    const { root, input } = fixture('rollback'),
      plan = planWordpressStatistics(input, root),
      db = new Database(join(root, 'analytics.sqlite'));
    db.exec(
      "CREATE TABLE wp_statistics_rows(fingerprint TEXT NOT NULL,table_name TEXT NOT NULL,row_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(fingerprint,table_name,row_id)); CREATE TRIGGER fail_migration BEFORE INSERT ON wp_statistics_rows WHEN NEW.table_name='relationships' BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
    );
    db.close();
    await expect(importWordpressStatistics(input, root, plan.review)).rejects.toThrow(
      /injected failure/,
    );
    const check = new Database(join(root, 'analytics.sqlite'), { readonly: true });
    try {
      expect(check.prepare('SELECT COUNT(*) count FROM wp_statistics_rows').get()).toEqual({
        count: 0,
      });
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name='wp_statistics_sources'").get(),
      ).toBeUndefined();
    } finally {
      check.close();
    }
    expect(readdirSync(join(root, 'imports', 'wp-statistics'))).toHaveLength(1);
  });
  it('generates a transport-independent exporter without credentials and refuses file overwrite', () => {
    mkdirSync(base, { recursive: true });
    const output = join(base, 'read.sh'),
      wp = "/var/www/blog's archive";
    const result = writeWordpressStatisticsExportScript(wp, output);
    expect(result.databaseReadOnly).toBe(true);
    const script = readFileSync(output, 'utf8');
    expect(script).toContain('SET TRANSACTION READ ONLY');
    expect(script).toContain('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    expect(script).not.toContain('185.201.9.239');
    expect(script).not.toContain('include ');
    expect(script).toContain(Buffer.from(wp).toString('base64'));
    expect(() => writeWordpressStatisticsExportScript(wp, output)).toThrow();
    expect(() => wordpressStatisticsExportScript('relative')).toThrow(/绝对/);
  });
  it('verifies every persisted source row against the archive and detects modification', async () => {
    const { root, input } = fixture('verification');
    const plan = planWordpressStatistics(input, root);
    await importWordpressStatistics(input, root, plan.review);
    expect(verifyWordpressStatistics(root).ok).toBe(true);
    const db = new Database(join(root, 'analytics.sqlite'));
    db.prepare(
      "UPDATE wp_statistics_rows SET data=json_set(data,'$.views',999) WHERE table_name='pages' AND row_id=10",
    ).run();
    db.close();
    expect(() => verifyWordpressStatistics(root)).toThrow(/来源表校验失败/);
    const retry = planWordpressStatistics(input, root);
    await expect(importWordpressStatistics(input, root, retry.review)).rejects.toThrow(
      /来源表校验失败/,
    );
  });
  it('normalizes JSON property order without breaking extraction checksums', () => {
    mkdirSync(base, { recursive: true });
    const raw: any = wordpressStatisticsFixture();
    raw.tables.pages.rows = raw.tables.pages.rows.map((r: any) =>
      Object.fromEntries(Object.entries(r).reverse()),
    );
    sealWordpressStatistics(raw);
    const input = join(base, 'ordered-source.json'),
      output = join(base, 'ordered-extracted.json');
    writeFileSync(input, JSON.stringify(raw));
    extractWordpressStatistics(input, output);
    expect(readWordpressStatistics(output).tables.pages.rows[0].views).toBe(2);
  });
  it('keeps overlapping row IDs in different WordPress sources independent', async () => {
    const { root, input } = fixture('multiple-sources');
    const first = planWordpressStatistics(input, root);
    await importWordpressStatistics(input, root, first.review);
    const second = wordpressStatisticsFixture();
    second.source.siteUrl = 'https://second.example';
    writeFileSync(input, JSON.stringify(second));
    const next = planWordpressStatistics(input, root);
    await importWordpressStatistics(input, root, next.review);
    expect(wordpressStatisticsSources(root)).toHaveLength(2);
    expect(verifyWordpressStatistics(root).sources).toHaveLength(2);
    expect(() => wordpressStatisticsReport(root)).toThrow(/source/);
    expect(
      wordpressStatisticsReport(root, new URLSearchParams({ source: first.sourceId })).totals
        .pageAggregateViews,
    ).toBe(4);
    expect(
      wordpressStatisticsReport(root, new URLSearchParams({ source: next.sourceId })).visitors
        .total,
    ).toBe(2);
  });
});
