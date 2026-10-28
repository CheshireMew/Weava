import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import type { Page, BrowserContext } from 'playwright';

export function seedExtensions(root: string) {
  const folder = join(root, 'extensions');
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ version: 1, extensions: [{ id: 'support', file: 'support.mjs' }, { id: 'notice', file: 'notice.mjs' }] }));
  writeFileSync(join(folder, 'support.ts'), `import {appendFileSync} from 'node:fs'; export default({site})=>({id:'support',label:'基础支持',apiVersion:1,version:'1.1.0',start(){appendFileSync(site.root+'/logs/extension-lifecycle.log','start:support\\n')},stop(){appendFileSync(site.root+'/logs/extension-lifecycle.log','stop:support\\n')}});`);
  writeFileSync(join(folder, 'notice.ts'), `import {appendFileSync} from 'node:fs'; export default({site,z})=>({id:'notice',label:'公告扩展',apiVersion:1,version:'1.0.0',dependencies:[{id:'support',minVersion:'1.1.0'}],schemaVersion:1,migrations:[{version:1,up(){site.store.put('notice-data','initial',{ready:true},null)}}],blocks:{'notice:banner':(block)=>'<aside class="site-notice">'+block.props.text+'</aside>'},blockDefinitions:{'notice:banner':{label:'扩展公告',fields:[{key:'text',label:'公告正文',control:'textarea',required:true}],schema:z.object({text:z.string().optional()})}},render:async(entry)=>{if(entry.title==='故意失败的整页渲染')throw new Error('async theme render failed');return null;},start(){appendFileSync(site.root+'/logs/extension-lifecycle.log','start:notice\\n')},stop(){appendFileSync(site.root+'/logs/extension-lifecycle.log','stop:notice\\n')}});`);
}
export async function checkExtensions({ origin, api, cli, page, context, output, root }: { origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[]) => Promise<any>; page: Page; context: BrowserContext; output: string; root: string }) {
  await page.getByRole('button', { name: '运行与备份', exact: true }).click();
  const card = page.locator('.extension-row').filter({ has: page.getByRole('heading', { name: '公告扩展', exact: true }) });
  await card.getByText('1.0.0 · 运行中', { exact: true }).waitFor();
  const status = await cli(['extensions', 'list']); assert.equal(status.find((row: any) => row.id === 'notice').installedSchema, 1);
  assert(existsSync(status.find((row: any) => row.id === 'notice').backup));
  await page.locator('.extension-row').filter({ has: page.getByRole('heading', { name: '基础支持', exact: true }) }).getByRole('button', { name: '停用', exact: true }).click();
  await page.getByText('扩展仍被以下内容或依赖使用，请先处理引用。', { exact: true }).waitFor();
  await card.getByRole('button', { name: '停用', exact: true }).click(); await card.getByText('1.0.0 · 已停用', { exact: true }).waitFor();
  await card.getByRole('button', { name: '启用', exact: true }).click(); await card.getByText('1.0.0 · 运行中', { exact: true }).waitFor();
  const before = readFileSync(join(root, 'logs', 'extension-lifecycle.log'), 'utf8');
  await api('entry', { value: { id: 'extension-page', kind: 'page', title: '扩展区块专项', path: '/extension/', blocks: [] }, revision: null });
  await page.getByRole('button', { name: '页面', exact: true }).click(); await page.getByLabel('搜索内容').fill('扩展区块专项');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '扩展区块专项', exact: true }) }).click();
  await page.getByLabel('区块类型').selectOption('notice:banner'); await page.getByRole('button', { name: '添加区块', exact: true }).click();
  await page.getByLabel('公告正文', { exact: true }).fill('由扩展声明与校验的正文');
  await page.getByRole('button', { name: '发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const visitor = await context.newPage(); await visitor.goto(origin + '/extension/'); await visitor.getByText('由扩展声明与校验的正文', { exact: true }).waitFor();
  assert.equal(readFileSync(join(root, 'logs', 'extension-lifecycle.log'), 'utf8'), before, 'worker must not start extension lifecycle hooks');
  const live=await api('entry/extension-page');const bad=await api('entry',{value:{...live.value,title:'故意失败的整页渲染'},revision:live.revision});
  const review=await context.request.post(origin+'/api/admin/v1/publication',{data:{ids:[live.id]}});assert.equal(review.status(),400);assert((await review.json()).error.includes('async theme render failed'));
  let failedJob=await api('publish',{ids:[live.id]});while(['queued','running'].includes(failedJob.status)){await new Promise((resolve)=>setTimeout(resolve,200));failedJob=await api('job/'+failedJob.id);}assert.equal(failedJob.status,'failed');assert(failedJob.message.includes('async theme render failed'));
  await visitor.reload();await visitor.getByText('由扩展声明与校验的正文',{exact:true}).waitFor();await api('entry',{value:live.value,revision:bad.revision});
  const usage = await cli(['extensions', 'usage', '--id', 'notice']); assert(usage.some((row: any) => row.kind === 'entry' && row.id === 'extension-page')); assert(usage.some((row: any) => row.kind === 'published'));
  await page.getByRole('button', { name: '运行与备份', exact: true }).click(); await card.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByText('扩展仍被以下内容或依赖使用，请先处理引用。', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'extension-dependencies.png'), fullPage: true });
  await visitor.close();
  return { compiledManifest: true, orderedDependencies: true, migrationBackup: true, browserToggle: true, declaredBlockEditor: true, workerRenderer: true, asyncFinalRendererFailurePreservesRelease:true, workerStartsNoLifecycle: true, activeUsageBlocksDisable: true, cliDiagnostics: true };
}
