#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  Site,
  assertOffline,
  restoreBackup,
  verifyBackup,
  recoverRestore,
  atomicJson,
  now,
  pullSearchData,
  planSearchData,
  writeWordpressStatisticsExportScript,
  extractWordpressStatistics,
  readWordpressStatistics,
  inspectWordpressStatistics,
  planWordpressStatistics,
  importWordpressStatistics,
  wordpressStatisticsSources,
  wordpressStatisticsReport,
  verifyWordpressStatistics,
} from '@weava/core';
import { seedDemo } from '../../core/src/demo.ts';
import { migrateCrypto } from '../../core/src/migrate.ts';
import { migrateWordPress, migrateWordPressViews } from '../../core/src/migrate-wordpress.ts';
import { importWordPressWxr } from '../../core/src/wordpress-wxr.ts';
import { compactDatabase } from '../../core/src/history-archive.ts';
import { selectedProgram,checkProgramUpgrade,applyProgramUpgrade,recoverProgramUpgrade,verifyProgram } from '../../core/src/programs.ts';
const framework =
  process.env.WEAVA_FRAMEWORK ??
  (import.meta.dirname.endsWith('dist')
    ? resolve(import.meta.dirname, '..')
    : resolve(import.meta.dirname, '../../..'));
const program = new Command()
  .name('weava')
  .version('0.1.0')
  .option('--site <path>', '站点目录', resolve(framework, '../WeavaSites/demo'))
  .option('--url <url>', '运行中的服务地址')
  .option('--human', '人工阅读格式');
function output(value: any) {
  console.log(JSON.stringify(value, null, program.opts().human ? 2 : 0));
}
function root() {
  return resolve(program.opts().site);
}
async function request(action: string, data?: any, format: 'json' | 'text' = 'json') {
  const config = existsSync(join(root(), 'site.json'))
    ? JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'))
    : {};
  const url = program.opts().url ?? `http://127.0.0.1:${config.port ?? 4322}`;
  const token = readFileSync(join(root(), 'cli-token'), 'utf8');
  const response = await fetch(url + '/api/admin/v1/' + action, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = format === 'text' ? await response.text() : await response.json() as any;
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function wait(job: any, enabled: boolean) {
  if (!enabled) return job;
  const end = Date.now() + 1800000;
  while (['queued', 'running'].includes(job.status)) {
    if (Date.now() > end) {
      process.exitCode = 2;
      return job;
    }
    await new Promise((r) => setTimeout(r, 500));
    job = await request('job/' + job.id);
  }
  if (job.status !== 'complete') process.exitCode = 1;
  return job;
}
program
  .command('init')
  .option('--password-file <file>')
  .option('--demo')
  .option('--port <port>', '端口', '4322')
  .action(async (opts) => {
    assertOffline(root());
    const fresh = !existsSync(join(root(), 'weava.sqlite'));
    const site = new Site(root());
    try {
      if (fresh && Number(opts.port) !== 4322) {
        const settings = site.settings();
        site.saveSettings(
          { ...settings.value, domain: `http://localhost:${Number(opts.port)}` },
          settings.revision,
        );
      }
      if (opts.passwordFile) site.setOwner(readFileSync(opts.passwordFile, 'utf8').trim());
      if (opts.demo) {
        mkdirSync(join(root(), 'media'), { recursive: true });
        writeFileSync(
          join(root(), 'media', 'demo-landscape.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#dce6d8"/><circle cx="920" cy="180" r="80" fill="#f6eed1"/><path d="M0 600 380 180 760 650 1200 270V700H0Z" fill="#829e80"/><path d="M0 700 430 390 750 700 1200 440V700Z" fill="#315c4c"/></svg>',
        );
        seedDemo(site);
      }
      if (!site.store.list('type').length)
        site.saveType(
          { id: 'post', label: '文章', pathPrefix: '/posts/', template: 'article', fields: [] },
          null,
        );
      atomicJson(join(root(), 'site.json'), { version: 1, port: Number(opts.port) });
      output({ site: root(), ownerInitialized: site.ownerExists() });
    } finally {
      site.close();
    }
  });
for (const mode of ['dev', 'start'])
  program
    .command(mode)
    .option('--port <port>')
    .action((opts) => {
      assertOffline(root());
      const config = JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'));
      const port = String(opts.port ?? config.port ?? 4322);
      const selected=mode==='start'?selectedProgram(root()):null;
      const args =
        mode === 'dev'
          ? [join(framework, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', port]
          : [selected?join(selected.root,'web/server/entry.mjs'):join(framework, 'apps/web/dist/server/entry.mjs')];
      const child = spawn(process.execPath, args, {
        cwd: mode === 'dev' ? join(framework, 'apps/web') : framework,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          WEAVA_FRAMEWORK: framework,
          WEAVA_SITE: root(),
          PORT: port,
          HOST: process.env.HOST ?? '127.0.0.1',
          ASTRO_TELEMETRY_DISABLED: '1',
          ...(selected?{WEAVA_PROGRAM_ROOT:selected.root,WEAVA_ADMIN_DIST:join(selected.root,'admin'),WEAVA_WORKER:join(selected.root,'runtime/worker.mjs'),WEAVA_SOURCE_WORKER:'0'}:{}),
        },
      });
      child.on('exit', (code) => {
        process.exitCode = code ?? 1;
      });
      process.on('SIGINT', () => child.kill('SIGINT'));
    });
program.command('build').option('--output <path>','独立版本构建目录').action((opts) => {
  const child = spawn(process.execPath, ['--import', 'tsx', join(framework, 'scripts/build.ts')], {
    cwd: framework,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, WEAVA_SITE: root(),...(opts.output?{WEAVA_BUILD_OUTPUT:resolve(opts.output)}:{}) },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
});
program
  .command('status')
  .option('--storage')
  .action(async (opts) =>
    output(
      opts.storage
        ? await request('maintenance')
        : await request('state').then((s) => ({
            site: root(),
            entries: s.entries.length,
            jobs: s.jobs,
            releases: s.releases,
          })),
    ),
  );
for (const name of ['content', 'page', 'settings', 'media']) {
  const command = program.command(name);
  if (['content', 'page'].includes(name)) command.command('get').requiredOption('--id <id>').action(async (opts) => output(await request('entry/' + encodeURIComponent(opts.id))));
  command
    .command('list')
    .option('--page <page>', '页码', '1')
    .option('--page-size <count>', '每页数量', '25')
    .option('--type <type>', '内容类型')
    .option('--category <category>', '分类编号或名称')
    .option('--tag <tag>', '标签编号或名称')
    .option('--query <text>', '标题和摘要')
    .option('--status <status>', '内容状态')
    .option('--visibility <visibility>', '可见性')
    .option('--field <key=value...>', '声明为可筛选的字段条件')
    .action(async (opts) =>
      output(
        await request(name === 'settings' ? 'settings' : name === 'media' ? 'media' : 'entries/query?' + new URLSearchParams({
          kind: name === 'page' ? 'page' : 'content', page: opts.page, pageSize: opts.pageSize,
          ...(opts.type ? { type: opts.type } : {}), ...(opts.category ? { category: opts.category } : {}),
          ...(opts.tag ? { tag: opts.tag } : {}), ...(opts.query ? { q: opts.query } : {}),
          ...(opts.status ? { status: opts.status } : {}), ...(opts.visibility ? { visibility: opts.visibility } : {}),
          ...Object.fromEntries((opts.field ?? []).map((value: string) => { const split = value.indexOf('='); if (split < 1) throw new Error('字段条件需要 key=value。'); return ['field.' + value.slice(0, split), value.slice(split + 1)]; })),
        })),
      ),
    );
  command
    .command('save')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await wait(
          await request(
            name === 'settings' ? 'settings' : name === 'media' ? 'media' : 'entry',
            JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
          ),
          name === 'media',
        ),
      ),
    );
}
program
  .command('publish')
  .option('--id <id...>')
  .option('--input <file>', '使用 publication preview 返回的原始检查结果')
  .option('--wait')
  .action(async (opts) =>
    output(await wait(await request('publish', (() => {
      if (opts.input && opts.id) throw new Error('--input 与 --id 不能同时使用。');
      if (!opts.input) return { ids: opts.id };
      const review = JSON.parse(readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, ''));
      if (!review.options || !Object.hasOwn(review.options, 'baseReleaseId') || !Number.isInteger(review.options.reviewRevision)) throw new Error('需要完整的发布预检结果。');
      return review.options;
    })()), !!opts.wait)),
  );
const publication = program.command('publication');
publication.command('preview').option('--id <id...>').option('--scope <scope>').option('--output <file>').action(async (opts) => {
  const review = await request('publication', { ...(opts.id ? { ids: opts.id } : {}), ...(opts.scope ? { scope: opts.scope } : {}) });
  if (opts.output) writeFileSync(resolve(opts.output), JSON.stringify(review, null, 2));
  output(review);
});
const seo = program.command('seo');
seo.command('audit').option('--draft', '检查当前候选工作稿').option('--http', '读取实际公开 HTTP 响应，最多 200 页').action(async (opts) => output(await request('seo/audit', { target: opts.draft ? 'draft' : 'published', http: !!opts.http })));
seo.command('reports').action(async () => output(await request('seo/audits')));
seo.command('metadata').requiredOption('--id <id>').option('--path <path>', '包含分页或筛选参数的页面地址').action(async (opts) => output(await request('seo/metadata?' + new URLSearchParams({ id: opts.id, ...(opts.path ? { path: opts.path } : {}) }))));
const searchData = program.command('search-data');
const analytics = program.command('analytics');
analytics.command('wordpress-verify').option('--source <id>').action(opts=>output(verifyWordpressStatistics(root(),opts.source)));
analytics.command('wordpress-sources').action(()=>output(wordpressStatisticsSources(root())));
analytics.command('wordpress-report').option('--source <id>').option('--start <date>').option('--end <date>').option('--path <path>').option('--visitor <id>').option('--page <page>').option('--output <file>','将历史来源报告保存为 JSON').action((opts)=>{const params=new URLSearchParams(Object.fromEntries(['source','start','end','path','visitor','page'].filter(k=>opts[k]).map(k=>[k,String(opts[k])])));const report=wordpressStatisticsReport(root(),params);if(opts.output){const file=resolve(opts.output);writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});output({path:file,sourceId:report.sourceId,totals:report.totals});}else output(report);});
const analyticsQuery = (opts: Record<string,any>) => new URLSearchParams(Object.fromEntries(['start','end','path','channel','country','browser','os','device','model','id','page'].filter((key)=>opts[key]).map((key)=>[key,String(opts[key])])));
analytics.command('report').option('--start <date>').option('--end <date>').option('--path <path>').option('--channel <channel>').option('--country <code>').option('--browser <browser>').option('--os <os>').option('--device <device>').option('--model <model>').action(async(opts)=>output(await request('analytics?'+analyticsQuery(opts))));
analytics.command('realtime').option('--path <path>').action(async(opts)=>output(await request('analytics/realtime?'+analyticsQuery(opts))));
analytics.command('visitor').requiredOption('--id <id>').option('--start <date>').option('--end <date>').option('--page <page>').action(async(opts)=>output(await request('analytics/visitor?'+analyticsQuery(opts))));
analytics.command('export').requiredOption('--output <file>').option('--dataset <dataset>','pages、daily、sources、countries、browsers、os、devices、models、visitors、links、actions、campaigns、crawlers、lifetime','pages').option('--start <date>').option('--end <date>').option('--path <path>').option('--channel <channel>').option('--country <code>').option('--device <device>').action(async(opts)=>{const query=analyticsQuery(opts);query.set('dataset',opts.dataset);const text=await request('analytics/export?'+query,undefined,'text');const file=resolve(opts.output);writeFileSync(file,text);output({path:file,dataset:opts.dataset,bytes:Buffer.byteLength(text)});});
analytics.command('geo-status').action(async()=>output(await request('analytics/geo')));
analytics.command('geo-update').action(async()=>{let state=await request('analytics/geo',{});const deadline=Date.now()+75000;while(state.updating&&Date.now()<deadline){await new Promise((r)=>setTimeout(r,1000));state=await request('analytics/geo');}if(state.error||state.updating)process.exitCode=1;output(state);});
searchData.command('plan').requiredOption('--config <file>', '连接配置，计划阶段不请求外部服务').action((opts) => output(planSearchData(JSON.parse(readFileSync(resolve(opts.config), 'utf8').replace(/^\ufeff/, '')))));
searchData.command('report').action(async () => output(await request('search-data')));
searchData.command('import').requiredOption('--input <file>').action(async (opts) => output(await request('search-data/import', JSON.parse(readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, '')))));
searchData.command('pull').requiredOption('--config <file>', '本地连接配置；令牌只用于本次请求').option('--output <file>', '保存不含凭据的数据集').action(async (opts) => {
  const dataset = await pullSearchData(JSON.parse(readFileSync(resolve(opts.config), 'utf8').replace(/^\ufeff/, '')));
  if (opts.output) writeFileSync(resolve(opts.output), JSON.stringify(dataset, null, 2));
  output(await request('search-data/import', dataset));
});
program
  .command('rollback')
  .requiredOption('--id <id>')
  .action(async (opts) => output(await request('rollback', { id: opts.id })));
const schedule = program.command('schedule');
const extensions = program.command('extensions');
extensions.command('list').action(async () => output(await request('extensions')));
extensions.command('usage').requiredOption('--id <id>').action(async (opts) => output(await request('extensions/usage?id=' + encodeURIComponent(opts.id))));
extensions.command('enable').requiredOption('--id <id>').requiredOption('--revision <revision>', '当前设置修订，新设置填 null').action(async (opts) => output(await request('extensions/toggle', { id: opts.id, enabled: true, revision: opts.revision === 'null' ? null : Number(opts.revision) })));
extensions.command('disable').requiredOption('--id <id>').requiredOption('--revision <revision>', '当前设置修订，新设置填 null').action(async (opts) => output(await request('extensions/toggle', { id: opts.id, enabled: false, revision: opts.revision === 'null' ? null : Number(opts.revision) })));
schedule.command('list').action(async () => output(await request('schedules')));
schedule.command('create').requiredOption('--id <id>').requiredOption('--revision <revision>').requiredOption('--at <time>', '带时区的发布时间').action(async (opts) =>
  output(await request('schedule', { id: opts.id, revision: Number(opts.revision), dueAt: opts.at })));
for (const action of ['cancel', 'retry']) schedule.command(action).requiredOption('--id <id>').requiredOption('--revision <revision>').action(async (opts) =>
  output(await request('schedule/' + action, { id: opts.id, revision: Number(opts.revision) })));
program
  .command('job')
  .requiredOption('--id <id>')
  .action(async (opts) => output(await request('job/' + opts.id)));
program
  .command('logs')
  .requiredOption('--id <id>')
  .option('--offset <offset>', '字符位置', '0')
  .action(async (opts) =>
    output(await request('logs?id=' + encodeURIComponent(opts.id) + '&offset=' + opts.offset)),
  );
const backup = program.command('backup');
const upgrade=program.command('upgrade');
upgrade.command('verify').requiredOption('--program <path>').action((opts)=>{const checked=verifyProgram(resolve(opts.program));output({root:checked.root,id:checked.manifest.id,framework:checked.manifest.framework,schemaVersion:checked.manifest.schemaVersion,files:checked.manifest.files.length});});
upgrade.command('check').requiredOption('--program <path>').option('--backup-root <path>','升级前备份和检查副本','D:/Tools/weava/backups').action(async(opts)=>output(await checkProgramUpgrade(root(),resolve(opts.program),resolve(opts.backupRoot))));
upgrade.command('apply').requiredOption('--input <file>','升级预检返回的计划文件').action(async(opts)=>{const plan=JSON.parse(readFileSync(resolve(opts.input),'utf8'));if(plan.target!==root())throw new Error('升级计划与当前站点不匹配。');output(await applyProgramUpgrade(plan));});
upgrade.command('recover').action(()=>output(recoverProgramUpgrade(root())));
upgrade.command('rollback').requiredOption('--restore-data','恢复升级前备份，升级后的资料保留在 retained 目录').action(()=>output(recoverProgramUpgrade(root(),true)));
upgrade.command('status').action(()=>{const selected=selectedProgram(root());output(selected?{id:selected.manifest.id,framework:selected.manifest.framework,root:selected.root,schemaVersion:selected.manifest.schemaVersion}:{selected:false,framework});});
const maintenance = program.command('maintenance');
maintenance.command('preview').requiredOption('--before <date>').option('--keep-releases <count>','至少保留公开版本数','20').option('--keep-revisions <count>','每个对象至少保留修订数','20').action(async(opts)=>output(await request('maintenance/preview',{before:opts.before,keepReleases:Number(opts.keepReleases),keepRevisions:Number(opts.keepRevisions)})));
maintenance.command('archive').requiredOption('--input <file>','预检结果 JSON').option('--wait').action(async(opts)=>{const plan=JSON.parse(readFileSync(resolve(opts.input),'utf8'));output(await wait(await request('maintenance/archive',{options:plan.options,review:plan.review}),!!opts.wait));});
maintenance.command('archives').action(async()=>output(await request('maintenance/archives')));
maintenance.command('inspect').requiredOption('--id <id>').action(async(opts)=>output(await request('maintenance/archive?id='+encodeURIComponent(opts.id))));
maintenance.command('restore').requiredOption('--id <id>').option('--wait').action(async(opts)=>output(await wait(await request('maintenance/restore',{id:opts.id}),!!opts.wait)));
maintenance.command('compact').action(async()=>{assertOffline(root());const site=new Site(root());try{output(await compactDatabase(site));}finally{site.close();}});
backup
  .command('create')
  .option('--path <path>', '备份根目录', 'D:/Tools/weava/backups')
  .option('--wait')
  .action(async (opts) =>
    output(await wait(await request('backup', { path: resolve(opts.path) }), !!opts.wait)),
  );
backup
  .command('verify')
  .requiredOption('--path <path>')
  .action((opts) => output(verifyBackup(resolve(opts.path))));
backup
  .command('restore')
  .requiredOption('--path <path>')
  .option('--backup-root <path>', '恢复前备份位置', 'D:/Tools/weava/backups')
  .action(async (opts) =>
    output(await restoreBackup(resolve(opts.path), root(), resolve(opts.backupRoot))),
  );
backup.command('recover').action(() => output(recoverRestore(root())));
program
  .command('export')
  .requiredOption('--output <file>')
  .action(async (opts) => {
    const data = await request('export');
    writeFileSync(resolve(opts.output), JSON.stringify(data, null, 2));
    output({ path: resolve(opts.output) });
  });
program
  .command('import')
  .requiredOption('--input <file>')
  .option('--merge', '合并已有对象，需要输入文件提供 revisions')
  .option('--dry-run', '完整校验并报告，不保存')
  .action(async (opts) => {
    const data = JSON.parse(readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, ''));
    output(await request('import', { value: data, options: { mode: opts.merge ? 'merge' : 'create', dryRun: !!opts.dryRun, revisions: data.revisions } }));
  });
program
  .command('owner')
  .command('reset-password')
  .requiredOption('--password-file <file>')
  .action((opts) => {
    assertOffline(root());
    const site = new Site(root());
    try {
      site.setOwner(readFileSync(resolve(opts.passwordFile), 'utf8').trim());
      output({ updated: true });
    } finally {
      site.close();
    }
  });
const migrate = program.command('migrate');
migrate.command('wxr')
  .requiredOption('--input <file>', 'WordPress 标准 WXR XML 导出文件')
  .option('--dry-run', '完整预检，不保存')
  .option('--settings', '同时导入网站名称、说明和语言')
  .option('--download-media', '下载 WXR 附件')
  .option('--media-dir <path>', '离线附件目录，按来源 URL 路径存放')
  .option('--no-comments', '不导入来源评论')
  .option('--merge-revisions <file>', '合并已有内容的当前修订号，格式与 JSON 导入相同')
  .action(async (opts) => {
    assertOffline(root()); const site = new Site(root());
    try { output(await importWordPressWxr(site, readFileSync(resolve(opts.input), 'utf8'), { dryRun: !!opts.dryRun, settings: !!opts.settings, downloadMedia: !!opts.downloadMedia,
      mediaDirectory: opts.mediaDir ? resolve(opts.mediaDir) : undefined, comments: opts.comments, ...(opts.mergeRevisions ? { mode: 'merge', revisions: JSON.parse(readFileSync(resolve(opts.mergeRevisions), 'utf8')) } : {}) })); }
    finally { site.close(); }
  });
migrate.command('crypto')
  .requiredOption('--source <path>')
  .requiredOption('--capture <path>')
  .option('--dry-run')
  .action(async (opts) => {
    assertOffline(root());
    output(await migrateCrypto(resolve(opts.source), root(), resolve(opts.capture), !!opts.dryRun));
  });
migrate.command('wordpress')
  .requiredOption('--source <path>', '已下载的 WordPress 内容目录')
  .option('--dry-run')
  .action(async (opts) => {
    assertOffline(root());
    output(await migrateWordPress(resolve(opts.source), root(), !!opts.dryRun));
  });
migrate.command('wordpress-views')
  .requiredOption('--input <file>', 'WordPress 文章累计浏览量快照')
  .action(async (opts) => {
    assertOffline(root());
    output(await migrateWordPressViews(resolve(opts.input), root()));
  });
migrate.command('wordpress-statistics-script')
  .requiredOption('--wordpress-root <path>','来源服务器上的 WordPress 绝对目录')
  .requiredOption('--output <file>','创建只读导出脚本，拒绝覆盖已有文件')
  .option('--php','输出独立 PHP 文件，默认输出可供 SSH 执行的 shell 脚本')
  .action(opts=>output(writeWordpressStatisticsExportScript(opts.wordpressRoot,opts.output,opts.php?'php':'shell')));
migrate.command('wordpress-statistics-extract')
  .requiredOption('--input <file>','server-ops JSON 响应或原始导出快照')
  .requiredOption('--output <file>','创建校验后的独立快照文件')
  .action(opts=>output(extractWordpressStatistics(resolve(opts.input),resolve(opts.output))));
migrate.command('wordpress-statistics-inspect')
  .requiredOption('--input <file>','独立快照或 server-ops JSON 响应')
  .action(opts=>output(inspectWordpressStatistics(readWordpressStatistics(resolve(opts.input)))));
migrate.command('wordpress-statistics')
  .requiredOption('--input <file>','WP Statistics 完整只读快照')
  .option('--dry-run','只预检，默认行为，不修改站点')
  .option('--plan-output <file>','保存预检方案，拒绝覆盖已有文件')
  .option('--apply','按预检方案导入；目标必须离线')
  .option('--review <file>','此前保存的预检方案 JSON')
  .action(async opts=>{
    if(opts.apply&&opts.dryRun)throw new Error('--apply 与 --dry-run 不能同时使用。');
    if(opts.apply){if(!opts.review)throw new Error('请先预检并使用 --review 提供方案。');const review=JSON.parse(readFileSync(resolve(opts.review),'utf8').replace(/^\ufeff/,''));output(await importWordpressStatistics(resolve(opts.input),root(),review.review));}
    else {const plan=planWordpressStatistics(resolve(opts.input),root());if(opts.planOutput)writeFileSync(resolve(opts.planOutput),JSON.stringify(plan,null,2),{flag:'wx'});output(plan);}
  });
try {
  await program.parseAsync();
} catch (error: any) {
  output({ error: error.message, details: error.details });
  process.exitCode = 1;
}
