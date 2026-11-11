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
  const comments=program.command('comments');
  comments.command('list').option('--status <status>','all、pending、visible、hidden','all').option('--query <text>').option('--author <name>').option('--path <path>').option('--start <date>').option('--end <date>').option('--page <page>','页码','1').action(async options=>output(await request('comments?'+new URLSearchParams(Object.fromEntries(Object.entries({status:options.status,q:options.query,author:options.author,path:options.path,start:options.start,end:options.end,page:options.page}).filter(([,value])=>value!==undefined) as [string,string][])))));
  comments.command('moderate').requiredOption('--input <file>','包含 items、expectedStatus 及目标 status 的 JSON').action(async options=>output(await request('comments/moderate',JSON.parse(readFileSync(resolve(options.input),'utf8')))));
  const events=program.command('events');
  events.command('list').option('--after <sequence>','起始序号','0').option('--types <types>','逗号分隔的事件类型').action(async options=>output(await request('events?'+new URLSearchParams({after:options.after,...(options.types?{types:options.types}:{})}))));
  events.command('consumers').action(async()=>output(await request('events/consumers')));
  events.command('register').requiredOption('--id <id>').option('--after <sequence>','起始序号','0').option('--types <types>').action(async options=>output(await request('events/consumers',{id:options.id,after:Number(options.after),...(options.types?{types:options.types.split(',')}:{})})));
  events.command('claim').requiredOption('--id <id>').action(async options=>output(await request('events/claim',{id:options.id})));
  events.command('finish').requiredOption('--id <id>').requiredOption('--token <token>').option('--error <message>','报告失败并等待退避重试').action(async options=>output(await request('events/finish',{id:options.id,token:options.token,...(options.error?{error:options.error}:{})})));
  events.command('retry').requiredOption('--id <id>').action(async options=>output(await request('events/retry',{id:options.id})));

  seo
    .command('audit')
    .option('--draft', '检查当前候选工作稿')
    .option('--http', '读取实际公开 HTTP 响应')
    .option('--max-pages <number>', '每批地址预算，1～1000，默认 200', '200')
    .option('--resume <report-id>', '从同一公开版本的 HTTP 报告继续检查')
    .action(async (opts) => {
      const job = await wait(await request('seo/audit', {
          target: opts.draft ? 'draft' : 'published',
          http: !!opts.http,
          maxPages: Number(opts.maxPages),
          ...(opts.resume ? { resume: opts.resume } : {}),
        }), true);
      output(job.status === 'complete' ? job.result : job);
    });

  seo.command('reports').action(async () => output(await request('seo/audits')));
  seo.command('insights').option('--start <date>', '窗口开始 YYYY-MM-DD').option('--end <date>', '窗口结束 YYYY-MM-DD')
    .action(async options => output(await request('seo/insights?' + new URLSearchParams({ ...(options.start ? { start: options.start } : {}), ...(options.end ? { end: options.end } : {}) }))));

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
  analytics.command('health').action(async()=>output(await request('analytics/health')));
  const archive=analytics.command('archive');
  archive.command('preview').requiredOption('--before <date>','UTC 截止日期').action(async options=>output(await request('analytics/archive/preview',{before:options.before})));
  archive.command('apply').requiredOption('--before <date>').requiredOption('--review <review>').option('--budget-mib <size>','本次归档文件体积上限','1024').option('--wait').action(async options=>output(await wait(await request('analytics/archive',{before:options.before,review:options.review,budgetBytes:Number(options.budgetMib)*1048576}),!!options.wait)));
  archive.command('list').action(async()=>output(await request('analytics/archives')));
  archive.command('days').requiredOption('--start <date>').requiredOption('--end <date>').option('--page <page>','页码','1').action(async options=>output(await request('analytics/archive/days?'+new URLSearchParams({start:options.start,end:options.end,page:options.page}))));
  archive.command('restore').requiredOption('--id <id>').option('--wait').action(async options=>output(await wait(await request('analytics/archive/restore',{id:options.id}),!!options.wait)));
  analytics.command('discovery').option('--dataset <dataset>','search 或 missing','search').option('--start <date>').option('--end <date>').option('--page <page>','页码','1').action(async options=>output(await request('analytics/discovery?'+new URLSearchParams({dataset:options.dataset,page:options.page,...(options.start?{start:options.start}:{}),...(options.end?{end:options.end}:{})}))));

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
