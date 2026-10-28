import { chromium } from 'playwright';
import { build } from 'vite';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { Site } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { checkAuthoring } from './check-authoring.ts';
import { checkEditing } from './check-editing.ts';
import { checkImport } from './check-import.ts';
import { seedExtensions, checkExtensions } from './check-extensions.ts';
import { checkOrganization } from './check-organization.ts';
import { checkMaintenance } from './check-maintenance.ts';
import { checkProgramUpgrade } from './check-program-upgrade.ts';
import { checkFiveSites } from './check-five-sites.ts';

const framework = resolve(import.meta.dirname, '..');
const output = 'D:/Tools/cache/weava/foundation-' + Date.now();
const root = join(output, 'site'), admin = join(output, 'admin');
const production = process.argv.includes('--production');
mkdirSync(output, { recursive: true });
const site = new Site(root), password = randomBytes(24).toString('hex');
site.setOwner(password);
site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
for (let i = 0; i < 33; i++) site.saveEntry(entrySchema.parse({ id: 'article-' + i, kind: 'content', title: 'Article ' + i,
  path: '/posts/' + i + '/', categories: ['写作'], status: 'published', document: { version: 1, format: 'markdown', source: '内容 ' + i } }), null);
site.saveEntry(entrySchema.parse({ id: 'home', kind: 'page', title: '首页', path: '/', status: 'published',
  blocks: [{ id: 'body', type: 'text', props: { text: '页面独有搜索词' } }, { id: 'list', type: 'content-list', props: {} }] }), null);
const settings = site.settings();
site.saveSettings({ ...settings.value, name: '隔离验收站', navigation: [{ label: '首页', url: '/', children: [{ label: '子导航', url: '/posts/0/' }] }] }, settings.revision);
site.publish();
const token = site.cliToken();
if (process.argv.includes('--extensions')) seedExtensions(root);
site.close();
if (production) {
  const status = await new Promise<number | null>((resolve) => {
    const buildProcess = spawn(process.execPath, ['--import', 'tsx', join(framework, 'scripts/build.ts')], {
      cwd: framework, windowsHide: true, stdio: 'inherit', env: { ...process.env, WEAVA_BUILD_OUTPUT: output, WEAVA_SITE: root, ASTRO_TELEMETRY_DISABLED: '1' },
    }); buildProcess.once('exit', resolve);
  });
  assert.equal(status, 0, 'isolated production build failed');
  // External Node dependencies remain in the existing workspace; no install or copy is needed.
  if(!existsSync(join(output,'node_modules')))symlinkSync(join(framework, 'node_modules'), join(output, 'node_modules'), 'junction');
} else await build({ root: join(framework, 'apps/admin'), configFile: join(framework, 'apps/admin/vite.config.ts'),
  cacheDir: join(output, 'vite-cache'), build: { outDir: admin, emptyOutDir: false } });
const portServer = createServer();
await new Promise<void>((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const port = (portServer.address() as any).port;
await new Promise<void>((resolve) => portServer.close(() => resolve()));
const origin = 'http://127.0.0.1:' + port;
writeFileSync(join(root, 'site.json'), JSON.stringify({ version: 1, port }));
const descriptor = openSync(join(output, 'server.log'), 'a');
const server = spawn(process.execPath, production ? [join(output, 'web/server/entry.mjs')] : [join(framework, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', String(port), '--host', '127.0.0.1'], {
  cwd: production ? framework : join(framework, 'apps/web'), windowsHide: true, stdio: ['ignore', descriptor, descriptor],
  env: { ...process.env, WEAVA_SITE: root, WEAVA_FRAMEWORK: framework, WEAVA_ADMIN_DIST: admin,
    PORT: String(port), HOST: '127.0.0.1', NODE_ENV: production ? 'production' : 'development',
    WEAVA_SOURCE_WORKER: production ? '0' : '1', ...(production ? { WEAVA_WORKER: join(output, 'runtime/worker.mjs') } : {}),
    ASTRO_TELEMETRY_DISABLED: '1', TEMP: output, TMP: output },
});
closeSync(descriptor);
const evidence: Record<string, any> = { output, root, port, source: production ? 'isolated production build including compiled worker' : 'current worktree; isolated Astro dev, freshly built admin; source worker' };
async function api(action: string, value?: any) {
  const response = await fetch(origin + '/api/admin/v1/' + action, { method: value === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
  const result = await response.json() as any;
  assert(response.ok, JSON.stringify(result)); return result;
}
async function cli(args: string[], instance = root) {
  return new Promise<any>((resolve, reject) => {
    const command = production ? [join(output, 'runtime/weava.mjs')] : ['--import', 'tsx', join(framework, 'packages/cli/src/index.ts')];
    const child = spawn(process.execPath, [...command, '--site', instance, '--url', origin, ...args], {
      cwd: framework, windowsHide: true, env: { ...process.env, WEAVA_FRAMEWORK: framework }, stdio: ['ignore', 'pipe', 'pipe'],
    }); let stdout = '', stderr = '';
    child.stdout.on('data', (data) => stdout += data); child.stderr.on('data', (data) => stderr += data);
    child.once('error', reject); child.once('close', (code) => {
      if (code !== 0) reject(new Error(stdout + '\n' + stderr)); else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
  });
}
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let inspectedPage: import('playwright').Page | undefined;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Isolated server exited; see server.log');
    try { const health = await fetch(origin + '/__health', { signal: AbortSignal.timeout(1500) });
      if (health.ok) { assert.equal((await health.json() as any).site, resolve(root)); ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, 'isolated source server did not become ready');
  const response = await fetch(origin + '/api/v1/content?limit=1&page=2&type=post');
  assert.equal((await response.json() as any[]).length, 1); assert.equal(response.headers.get('X-Total-Count'), '33');
  const search = await (await fetch(origin + '/api/v1/search?q=' + encodeURIComponent('页面独有搜索词'))).json() as any[];
  assert.equal(search[0]?.id, 'home');
  evidence.publicApi = { pageSize: 1, total: 33, blockSearchHit: 'home' };
  const before = (await fetch(origin + '/__health').then((response) => response.json()) as any).releaseId;
  const bad = await fetch(origin + '/api/admin/v1/entry', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: { id: 'bad', kind: 'page', title: '错误画廊', path: '/bad/', blocks: [{ id: 'g', type: 'gallery', props: { images: 'bad' } }] }, revision: null }) });
  assert.equal(bad.status, 400); evidence.invalidBlockRejected = true;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.request.post(origin + '/api/admin/v1/login', { data: { password } });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  inspectedPage = page;
  await page.goto(origin + '/');
  assert.equal(await page.locator('.cards > .card').count(), 24);
  await page.getByRole('link', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('.cards > .card').count(), 9);
  await page.screenshot({ path: join(output, 'page-2.png'), fullPage: true });
  evidence.browserPagination = [24, 9];
  await page.goto(origin + '/admin/');
  await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
  await page.locator('.entry-list button').first().waitFor();
  assert.equal(await page.locator('.entry-list button').count(), 25);
  await page.getByRole('navigation', { name: '内容列表分页' }).getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.entry-list button').length === 8);
  await page.getByRole('navigation', { name: '内容列表分页' }).getByRole('button', { name: '上一页' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.entry-list button').length === 25);
  evidence.adminPagination = [25, 8];
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: 'Article 0', exact: true }) }).click();
  await page.getByLabel('写作', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('写作', { exact: true }).isChecked(), true);
  await page.getByLabel('查找或新建标签').fill('浏览器标签');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByLabel('内容标题').fill('未发布的文章改稿');
  await page.getByText('已保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '外观与导航', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('只发布的新站名');
  await page.getByRole('button', { name: '发布设置', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  assert.equal(await page.locator('.modal').getByText('未发布的文章改稿', { exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'settings-review.png'), fullPage: true });
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const publicAfter = await fetch(origin + '/api/v1/content?limit=100').then((response) => response.json()) as any[];
  assert.equal(publicAfter.find((entry) => entry.id === 'article-0')?.title, 'Article 0');
  assert.notEqual((await fetch(origin + '/__health').then((response) => response.json()) as any).releaseId, before);
  evidence.browserSettingsPublication = { publicArticleTitle: 'Article 0', siteName: '只发布的新站名', sourceWorkerCompleted: true };
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '未发布的文章改稿', exact: true }) }).click();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const html = await fetch(origin + '/posts/0/').then((response) => response.text());
  assert(html.includes('未发布的文章改稿')); evidence.browserArticlePublication = true;
  const tagged = await fetch(origin + '/api/v1/content?tag=' + encodeURIComponent('浏览器标签')).then((response) => response.json()) as any[];
  assert.equal(tagged.length, 1); assert.equal(tagged[0].id, 'article-0'); evidence.termPicker = true;
  await page.goto(origin + '/');
  const parent = page.locator('#nav > .nav-branch'); await parent.hover();
  await page.getByRole('link', { name: '子导航', exact: true }).waitFor({ state: 'visible' });
  evidence.nestedNavigation = true;
  const exported = await api('export');
  const dry = await api('import', { value: exported, options: { dryRun: true } });
  assert.equal(dry.created.length, 0); assert.equal(dry.updated.length, 0);
  evidence.exchangeDryRun = { unchanged: dry.unchanged.length };
  const draft = await api('entry', { value: entrySchema.parse({ id: 'scheduled', kind: 'content', title: '选定的定时修订', path: '/scheduled/' }), revision: null });
  const scheduled = await api('schedule', { id: draft.id, revision: draft.revision, dueAt: new Date(Date.now() + 2000).toISOString() });
  await api('entry', { value: { ...draft.value, title: '定时之后的工作稿' }, revision: draft.revision });
  let completed = false;
  for (let i = 0; i < 30; i++) {
    const plans = await api('schedules'); const plan = plans.find((item: any) => item.id === scheduled.id);
    if (plan.value.status === 'failed') throw new Error(plan.value.error);
    if (plan.value.status === 'complete') { completed = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(completed, 'scheduled publication did not complete');
  const publicScheduled = await fetch(origin + '/scheduled/').then((response) => response.text());
  assert(publicScheduled.includes('选定的定时修订')); assert(!publicScheduled.includes('定时之后的工作稿'));
  assert.equal((await api('entry/scheduled')).value.title, '定时之后的工作稿');
  evidence.scheduledPublication = { completed: true, selectedRevisionPublished: true, laterDraftPreserved: true };
  const file = join(output, 'exchange.json');
  await cli(['export', '--output', file]);
  const imported = await cli(['import', '--input', file, '--dry-run']);
  assert.equal(imported.created.length, 0); assert.equal(imported.updated.length, 0);
  const plans = await cli(['schedule', 'list']);
  assert.equal(plans.find((plan: any) => plan.id === scheduled.id).value.status, 'complete');
  const contentList = await cli(['content', 'list', '--page', '2', '--page-size', '10']);
  assert.equal(contentList.items.length, 10); assert.equal(contentList.total, 34);
  evidence.cli = { export: true, importDryRun: true, scheduleList: true, paginatedContent: true, compiled: production };
  if (process.argv.includes('--authoring')) evidence.authoring = await checkAuthoring({ origin, api, page, context, output });
  if (process.argv.includes('--authoring')) evidence.editing = await checkEditing({ origin, api, page, context, output });
  if (process.argv.includes('--authoring')) evidence.wordpress = await checkImport({ origin, api, cli, page, context, output });
  if (process.argv.includes('--extensions')) evidence.extensions = await checkExtensions({ origin, api, cli, page, context, output, root });
  if (process.argv.includes('--organization')) evidence.organization = await checkOrganization({ origin, api, cli, page, context, output });
  if (process.argv.includes('--maintenance')) evidence.maintenance = await checkMaintenance({ origin, api, cli, page, context, output });
  if (process.argv.includes('--five-sites')) evidence.fiveSites = await checkFiveSites(output,framework);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/admin/'); await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'admin-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); evidence.browserErrors = errors;
  evidence.passed = true;
} catch (error: any) {
  evidence.failed = error.message; evidence.browserErrors = errors;
  if (inspectedPage && !inspectedPage.isClosed()) {
    await inspectedPage.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    writeFileSync(join(output, 'failure.html'), await inspectedPage.content().catch(() => ''));
  }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve())); server.kill(); await stopped;
  }
  evidence.serviceStopped = true;
  if(evidence.passed&&process.argv.includes('--upgrade')){
    try{evidence.upgrade=await checkProgramUpgrade({output,root,framework});}catch(error:any){evidence.passed=false;evidence.upgradeFailure=error.message;process.exitCode=1;}
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
