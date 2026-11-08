import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  pullSearchData,
  planSearchData,
  wordpressStatisticsSources,
  wordpressStatisticsReport,
  verifyWordpressStatistics,
} from '@weava/core';
import type { CliContext } from '../context.ts';

export function registerReportsCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  const seo = program.command('seo');

  seo
    .command('audit')
    .option('--draft', '检查当前候选工作稿')
    .option('--http', '读取实际公开 HTTP 响应，最多 200 页')
    .action(async (opts) => {
      const job = await wait(await request('seo/audit', {
          target: opts.draft ? 'draft' : 'published',
          http: !!opts.http,
        }), true);
      output(job.status === 'complete' ? job.result : job);
    });

  seo.command('reports').action(async () => output(await request('seo/audits')));

  seo
    .command('metadata')
    .requiredOption('--id <id>')
    .option('--path <path>', '包含分页或筛选参数的页面地址')
    .action(async (opts) =>
      output(
        await request(
          'seo/metadata?' +
            new URLSearchParams({ id: opts.id, ...(opts.path ? { path: opts.path } : {}) }),
        ),
      ),
    );

  const searchData = program.command('search-data');

  const analytics = program.command('analytics');

  analytics
    .command('wordpress-verify')
    .option('--source <id>')
    .action((opts) => output(verifyWordpressStatistics(root(), opts.source)));

  analytics.command('wordpress-sources').action(() => output(wordpressStatisticsSources(root())));

  analytics
    .command('wordpress-report')
    .option('--source <id>')
    .option('--start <date>')
    .option('--end <date>')
    .option('--path <path>')
    .option('--visitor <id>')
    .option('--page <page>')
    .option('--output <file>', '将历史来源报告保存为 JSON')
    .action((opts) => {
      const params = new URLSearchParams(
        Object.fromEntries(
          ['source', 'start', 'end', 'path', 'visitor', 'page']
            .filter((k) => opts[k])
            .map((k) => [k, String(opts[k])]),
        ),
      );
      const report = wordpressStatisticsReport(root(), params);
      if (opts.output) {
        const file = resolve(opts.output);
        writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx' });
        output({ path: file, sourceId: report.sourceId, totals: report.totals });
      } else output(report);
    });

  const analyticsQuery = (opts: Record<string, any>) =>
    new URLSearchParams(
      Object.fromEntries(
        [
          'start',
          'end',
          'path',
          'channel',
          'country',
          'browser',
          'os',
          'device',
          'model',
          'id',
          'page',
        ]
          .filter((key) => opts[key])
          .map((key) => [key, String(opts[key])]),
      ),
    );

  analytics
    .command('report')
    .option('--start <date>')
    .option('--end <date>')
    .option('--path <path>')
    .option('--channel <channel>')
    .option('--country <code>')
    .option('--browser <browser>')
    .option('--os <os>')
    .option('--device <device>')
    .option('--model <model>')
    .action(async (opts) => output(await request('analytics?' + analyticsQuery(opts))));

  analytics
    .command('realtime')
    .option('--path <path>')
    .action(async (opts) => output(await request('analytics/realtime?' + analyticsQuery(opts))));

  analytics
    .command('visitor')
    .requiredOption('--id <id>')
    .option('--start <date>')
    .option('--end <date>')
    .option('--page <page>')
    .action(async (opts) => output(await request('analytics/visitor?' + analyticsQuery(opts))));

  analytics
    .command('export')
    .requiredOption('--output <file>')
    .option(
      '--dataset <dataset>',
      'pages、daily、sources、countries、browsers、os、devices、models、visitors、links、actions、campaigns、crawlers、lifetime',
      'pages',
    )
    .option('--start <date>')
    .option('--end <date>')
    .option('--path <path>')
    .option('--channel <channel>')
    .option('--country <code>')
    .option('--device <device>')
    .action(async (opts) => {
      const query = analyticsQuery(opts);
      query.set('dataset', opts.dataset);
      const text = await request('analytics/export?' + query, undefined, 'text');
      const file = resolve(opts.output);
      writeFileSync(file, text);
      output({ path: file, dataset: opts.dataset, bytes: Buffer.byteLength(text) });
    });

  analytics.command('geo-status').action(async () => output(await request('analytics/geo')));

  analytics.command('geo-update').action(async () => {
    let state = await request('analytics/geo', {});
    const deadline = Date.now() + 75000;
    while (state.updating && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      state = await request('analytics/geo');
    }
    if (state.error || state.updating) process.exitCode = 1;
    output(state);
  });

  searchData
    .command('plan')
    .requiredOption('--config <file>', '连接配置，计划阶段不请求外部服务')
    .action((opts) =>
      output(
        planSearchData(
          JSON.parse(readFileSync(resolve(opts.config), 'utf8').replace(/^\ufeff/, '')),
        ),
      ),
    );

  searchData.command('report').action(async () => output(await request('search-data')));

  searchData
    .command('import')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await request(
          'search-data/import',
          JSON.parse(readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, '')),
        ),
      ),
    );

  searchData
    .command('pull')
    .requiredOption('--config <file>', '本地连接配置；令牌只用于本次请求')
    .option('--output <file>', '保存不含凭据的数据集')
    .action(async (opts) => {
      const dataset = await pullSearchData(
        JSON.parse(readFileSync(resolve(opts.config), 'utf8').replace(/^\ufeff/, '')),
      );
      if (opts.output) writeFileSync(resolve(opts.output), JSON.stringify(dataset, null, 2));
      output(await request('search-data/import', dataset));
    });
}
