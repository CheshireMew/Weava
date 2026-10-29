import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  Site,
  Analytics,
  digest,
  readWordpressStatistics,
  inspectWordpressStatistics,
} from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { wordpressStatisticsFixture } from '../tests/fixtures/wordpress-statistics.ts';

const output = resolve('D:/Tools/cache/weava/wp-statistics-tools-' + Date.now()),
  wp = join(output, 'wordpress'),
  target = join(output, 'target');
mkdirSync(join(wp, 'wp-content', 'plugins', 'wp-statistics'), { recursive: true });
writeFileSync(
  join(wp, 'wp-config.php'),
  "<?php\ndefine('DB_NAME','fixture'); define('DB_USER','fixture'); define('DB_PASSWORD','fixture-secret'); define('DB_HOST','localhost'); $table_prefix='wp_'; throw new Exception('wp-config must never execute');",
);
writeFileSync(
  join(wp, 'wp-content', 'plugins', 'wp-statistics', 'wp-statistics.php'),
  '<?php\n/**\n * Version: 14.16.10\n */',
);
const fixture = wordpressStatisticsFixture(),
  tables: any = { wp_options: [] },
  options = [
    { option_name: 'home', option_value: fixture.source.siteUrl },
    { option_name: 'timezone_string', option_value: fixture.source.timezone },
    { option_name: 'gmt_offset', option_value: '8' },
  ];
const definitions: Record<string, { table: string; fields: Record<string, string> }> = {
  visitors: {
    table: 'visitor',
    fields: {
      id: 'ID',
      day: 'last_counter',
      browser: 'agent',
      os: 'platform',
      browserVersion: 'version',
      device: 'device',
      model: 'model',
      country: 'location',
      city: 'city',
      region: 'region',
      continent: 'continent',
      referrer: 'referred',
      sourceChannel: 'source_channel',
      sourceName: 'source_name',
      hits: 'hits',
      firstPage: 'first_page',
      firstView: 'first_view',
      lastPage: 'last_page',
      lastView: 'last_view',
    },
  },
  pages: {
    table: 'pages',
    fields: {
      id: 'page_id',
      uri: 'uri',
      type: 'type',
      day: 'date',
      views: 'count',
      objectId: 'id',
    },
  },
  relationships: {
    table: 'visitor_relationships',
    fields: { id: 'ID', visitorId: 'visitor_id', pageId: 'page_id', at: 'date' },
  },
  daily: {
    table: 'summary_totals',
    fields: { id: 'ID', day: 'date', visitors: 'visitors', views: 'views' },
  },
  historical: {
    table: 'historical',
    fields: { id: 'ID', category: 'category', pageId: 'page_id', uri: 'uri', value: 'value' },
  },
  events: {
    table: 'events',
    fields: {
      id: 'ID',
      at: 'date',
      pageId: 'page_id',
      visitorId: 'visitor_id',
      name: 'event_name',
    },
  },
};
for (const [name, definition] of Object.entries(definitions))
  tables['wp_statistics_' + definition.table] = (fixture.tables as any)[name].rows.map((row: any) =>
    Object.fromEntries(
      Object.entries(definition.fields).map(([from, to]) => [
        to,
        row[from] === null ? null : String(row[from]),
      ]),
    ),
  );
tables.wp_statistics_visitor[0].ip = 'should-not-export';
tables.wp_statistics_visitor[0].user_id = 'private-user';
tables.wp_statistics_visitor[0].UAString = 'raw-agent';
tables.wp_statistics_visitor[0].referred = 'https://chatgpt.com/?secret=should-not-export';
const fixtureFile = join(output, 'mysql-fixture.json'),
  queryLog = join(output, 'queries.json');
writeFileSync(fixtureFile, JSON.stringify({ tables, options }));
const php = process.env.WEAVA_TEST_PHP || 'D:/Tools/cache/weava/php-runtime/php-8.5.12-1/php.exe';
if (!existsSync(php)) throw new Error('请通过 WEAVA_TEST_PHP 指定 PHP CLI（只用于隔离导出验证）。');
const production = process.argv.includes('--production');
const cli = (args: string[], ok = true) => {
  const result = spawnSync(
    process.execPath,
    [
      ...(production
        ? [resolve('dist/weava.mjs')]
        : ['--import', 'tsx', resolve('packages/cli/src/index.ts')]),
      '--site',
      target,
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, ok ? 0 : 1, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
const exporter = join(output, 'export.php');
// Replace only the encoded root for the Windows fixture; the generated exporter body stays identical.
cli([
  'migrate',
  'wordpress-statistics-script',
  '--wordpress-root',
  '/var/www/fixture',
  '--output',
  exporter,
  '--php',
]);
let script = readFileSync(exporter, 'utf8');
script = script.replace(
  Buffer.from('/var/www/fixture').toString('base64'),
  Buffer.from(wp).toString('base64'),
);
writeFileSync(exporter, script);
const lint = spawnSync(php, ['-n', '-l', exporter], { encoding: 'utf8', windowsHide: true });
assert.equal(lint.status, 0, lint.stdout + lint.stderr);
const runPhp = () =>
  spawnSync(
    php,
    [
      '-n',
      '-d',
      'auto_prepend_file=' + resolve('tests/fixtures/wp-statistics-mysqli.php'),
      exporter,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, WEAVA_WP_FIXTURE: fixtureFile, WEAVA_WP_QUERY_LOG: queryLog },
    },
  );
const execution = runPhp();
assert.equal(execution.status, 0, execution.stderr || execution.stdout);
assert(!execution.stdout.includes('should-not-export'));
assert(!execution.stdout.includes('fixture-secret'));
const response = join(output, 'server-ops-response.json'),
  snapshot = join(output, 'snapshot.json');
writeFileSync(response, JSON.stringify({ exit_code: 0, stdout: execution.stdout, stderr: '' }));
assert.equal(
  cli(['migrate', 'wordpress-statistics-extract', '--input', response, '--output', snapshot]).counts
    .visitors,
  2,
);
const parsed = readWordpressStatistics(snapshot);
assert.equal(parsed.source.pluginVersion, fixture.source.pluginVersion);
assert.deepEqual(inspectWordpressStatistics(parsed).totals, {
  dailyViews: 27,
  dailyVisitors: 16,
  pageViews: 4,
  visitorHits: 4,
  historical: { visits: 24, uri: 20 },
});
const queries = JSON.parse(readFileSync(queryLog, 'utf8'));
assert.deepEqual(queries.slice(0, 2), [
  'SET TRANSACTION READ ONLY',
  'START TRANSACTION WITH CONSISTENT SNAPSHOT',
]);
assert.equal(queries.at(-1), 'ROLLBACK');
assert(
  queries.every((q: string) =>
    /^(SELECT|SHOW|SET TRANSACTION READ ONLY|START TRANSACTION WITH CONSISTENT SNAPSHOT|ROLLBACK)/.test(
      q,
    ),
  ),
);
const site = new Site(target);
site.saveType(
  { id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' },
  null,
);
site.saveEntry(
  entrySchema.parse({
    id: 'wp-42',
    kind: 'content',
    title: '已有文章',
    path: '/first/',
    status: 'published',
    source: { system: 'wordpress', id: 42, originalUrl: 'https://wordpress.example/first/' },
  }),
  null,
);
site.publish();
site.close();
const a = new Analytics(target);
a.importViewTotals({
  sourceId: 'puock',
  capturedAt: '2026-01-01T00:00:00Z',
  entries: [{ entryId: 'wp-42', path: '/first/', views: 99 }],
});
a.close();
const nativeBefore = digest(readFileSync(join(target, 'analytics.sqlite'))),
  contentBefore = digest(readFileSync(join(target, 'weava.sqlite'))),
  planFile = join(output, 'plan.json');
const plan = cli([
  'migrate',
  'wordpress-statistics',
  '--input',
  snapshot,
  '--plan-output',
  planFile,
]);
assert.equal(plan.action, 'import');
assert.equal(digest(readFileSync(join(target, 'analytics.sqlite'))), nativeBefore);
assert(!existsSync(join(target, 'imports', 'wp-statistics')));
const imported = cli([
  'migrate',
  'wordpress-statistics',
  '--input',
  snapshot,
  '--apply',
  '--review',
  planFile,
]);
assert(imported.changed);
assert(existsSync(imported.backup));
assert.equal(digest(readFileSync(join(target, 'weava.sqlite'))), contentBefore);
const replayPlan = join(output, 'replay-plan.json');
cli(['migrate', 'wordpress-statistics', '--input', snapshot, '--plan-output', replayPlan]);
assert.equal(
  cli(['migrate', 'wordpress-statistics', '--input', snapshot, '--apply', '--review', replayPlan])
    .changed,
  false,
);
const report = cli(['analytics', 'wordpress-report', '--visitor', '1']);
assert(cli(['analytics', 'wordpress-verify']).ok);
assert.equal(report.activity.total, 2);
assert.equal(report.totals.sessions, null);
assert.equal(report.daily.find((d: any) => d.day === '2026-10-28').views, 3);
assert.equal(cli(['analytics', 'wordpress-sources']).length, 1);
const failedExport = JSON.parse(readFileSync(fixtureFile, 'utf8'));
failedExport.failTable = 'wp_statistics_pages';
writeFileSync(fixtureFile, JSON.stringify(failedExport));
const failed = runPhp();
assert.equal(failed.status, 1);
assert(!failed.stderr.includes('fixture-secret'));
assert.equal(failed.stdout, '');
const result = {
  ok: true,
  production,
  output,
  phpVersion: spawnSync(php, ['-n', '-v'], { encoding: 'utf8', windowsHide: true })
    .stdout.split('\n')[0]
    .trim(),
  checks: {
    phpSyntax: true,
    phpExporterRunsAgainstReadOnlyFixture: true,
    sourceConfigNotExecuted: true,
    sourceFieldsAndChecksums: true,
    serverOpsEnvelope: true,
    preflightNoWrites: true,
    applyBackup: true,
    replayNoDuplicates: true,
    importedDataVerification: true,
    contentUnchanged: true,
    separateHistoricalReport: true,
    exportFailureNoPartialSnapshot: true,
    credentialsExcluded: true,
  },
  realServerExported: false,
  realSiteImported: false,
};
writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
