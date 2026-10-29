import { chromium, type Page } from 'playwright';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { load } from 'cheerio';
import { Site } from '@weava/core';
import { entrySchema } from '@weava/contracts';

// Creates only an owned isolated site and build; retains all evidence. No external accounts.
const framework = resolve(import.meta.dirname, '..');
const output = resolve(process.env.WEAVA_CHECK_OUTPUT || 'D:/Tools/cache/weava/seo-' + Date.now());
const buildOutput = process.env.WEAVA_CHECK_BUILD || output;
const root = join(output, 'site'); mkdirSync(output, { recursive: true });
const listener = createServer(); await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as any).port; await new Promise<void>((done) => listener.close(() => done()));
const origin = 'http://127.0.0.1:' + port, password = randomBytes(24).toString('hex');
const site = new Site(root); site.setOwner(password);
site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
site.saveType({ id: 'software', label: '软件', fields: [], pathPrefix: '/apps/', template: 'article', schemaType: 'SoftwareApplication' }, null);
for (let i = 0; i < 33; i++) site.saveEntry(entrySchema.parse({ id: 'article-' + i, kind: 'content', title: 'Article ' + i, description: '独立摘要 ' + i, path: '/posts/' + i + '/', status: 'published',
  document: { version: 1, format: 'markdown', source: '## 正文\n\n文章 ' + i }, ...(i === 0 ? { evidence: [{ id: 'source', claim: '已核验说法', title: '来源文档', url: 'https://example.test/docs', status: 'verified', verifiedAt: '2026-01-01', validUntil: '2099-01-01' }] } : {}) }), null);
site.saveEntry(entrySchema.parse({ id: 'home', kind: 'page', title: '首页', path: '/', description: '首页摘要', status: 'published', blocks: [{ id: 'list', type: 'content-list', props: {} }] }), null);
site.saveEntry(entrySchema.parse({ id: 'custom', kind: 'page', title: '扩展页面', path: '/custom/', description: '扩展摘要', status: 'published' }), null);
site.saveEntry(entrySchema.parse({ id: 'private', kind: 'content', title: '私密标题', path: '/private/', visibility: 'private', status: 'published' }), null);
site.saveEntry(entrySchema.parse({ id: 'app', kind: 'content', type: 'software', title: '软件说明', description: '软件摘要', path: '/apps/tool/', status: 'published', blocks: [{ id: 'faq', type: 'faq', props: { items: [{ question: '支持什么？', answer: '支持文档。' }] } }] }), null);
const settings = site.settings(); site.saveSettings({ ...settings.value, name: '搜索验收站', domain: origin, description: '隔离站点', navigation: [{ label: '首页', url: '/' }, { label: '软件', url: 'entry:app' }] }, settings.revision);
site.publish(); const token = site.cliToken(); site.close();
mkdirSync(join(root, 'extensions'), { recursive: true });
writeFileSync(join(root, 'extensions/index.mjs'), `export default () => ({ id:'seo-check',apiVersion:1,metadata:(entry)=>entry.id==='custom'?{schemaType:'AboutPage',title:'扩展搜索标题'}:null,render:(entry)=>entry.id==='custom'?'<html><head><title>旧标题</title><meta name="description" content="旧摘要"></head><body><main><h1>扩展页面</h1><a href="/">首页</a></main></body></html>':null });`);
writeFileSync(join(root, 'site.json'), JSON.stringify({ version: 1, port }));
if (!process.env.WEAVA_CHECK_BUILD) {
  const code = await new Promise<number | null>((done, fail) => { const child = spawn(process.execPath, ['--import', 'tsx', join(framework, 'scripts/build.ts')], { cwd: framework, windowsHide: true, stdio: 'inherit', env: { ...process.env, WEAVA_BUILD_OUTPUT: buildOutput, WEAVA_SITE: root, ASTRO_TELEMETRY_DISABLED: '1' } }); child.once('error', fail); child.once('exit', done); });
  assert.equal(code, 0, 'production build failed');
}
const log = openSync(join(output, 'server.log'), 'a');
const server = spawn(process.execPath, [join(buildOutput, 'web/server/entry.mjs')], { cwd: framework, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, WEAVA_SITE: root, WEAVA_FRAMEWORK: framework, WEAVA_ADMIN_DIST: join(buildOutput, 'admin'), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', WEAVA_SOURCE_WORKER: '0', WEAVA_WORKER: join(buildOutput, 'runtime/worker.mjs'), TEMP: output, TMP: output } }); closeSync(log);
const evidence: Record<string, any> = { output, buildOutput, platform: process.platform, source: 'compiled production server, worker and CLI; real HTTP and Chrome; isolated site', serverPid: server.pid };
async function api(action: string, value?: any) { const response = await fetch(origin + '/api/admin/v1/' + action, { method: value === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) }); const data = await response.json() as any; assert(response.ok, JSON.stringify(data)); return data; }
async function cli(args: string[], expected = 0) { return await new Promise<any>((done, fail) => { const child = spawn(process.execPath, [join(buildOutput, 'runtime/weava.mjs'), '--site', root, '--url', origin, ...args], { cwd: framework, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', (chunk) => stdout += chunk); child.stderr.on('data', (chunk) => stderr += chunk); child.once('error', fail); child.once('close', (code) => { try { assert.equal(code, expected, stdout + stderr); done(JSON.parse(stdout)); } catch (error) { fail(error); } }); }); }
async function publish(args: string[] = []) { const file = join(output, 'review-' + Date.now() + '.json'); await cli(['publication', 'preview', ...args, '--output', file]); const result = await cli(['publish', '--input', file, '--wait']); assert.equal(result.status, 'complete'); return result; }
async function readPage(path: string) { const response = await fetch(origin + path); assert.equal(response.status, 200); return load(await response.text()); }
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, page: Page | undefined;
const errors: string[] = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { if (server.exitCode !== null) throw new Error('server exited; see server.log'); try { const response = await fetch(origin + '/__health', { signal: AbortSignal.timeout(1500) }); if (response.ok) { assert.equal((await response.json() as any).site, root); ready = true; break; } } catch {} await new Promise((done) => setTimeout(done, 500)); }
  assert(ready, 'server failed to start');
  const second = await readPage('/?page=2&utm_source=test'); assert.equal(second('link[rel="canonical"]').attr('href'), origin + '/?page=2'); assert.equal(second('.cards > .card').length, 10); // 33 posts plus one software entry, 24 on page one.
  assert.equal((await readPage('/?page=2&sort=popular'))('meta[name="robots"]').attr('content'), 'noindex,follow');
  assert.equal((await readPage('/search/?q=test'))('meta[name="robots"]').attr('content'), 'noindex,follow');
  const custom = await readPage('/custom/'); assert.equal(custom('title').length, 1); assert(custom('title').text().includes('扩展搜索标题')); assert.equal(custom('script[data-weava-seo]').length, 1); assert.equal(custom('script[src="/weava-analytics.js"]').length, 1);
  const app = await readPage('/apps/tool/'), graph = JSON.parse(app('script[data-weava-seo]').html()!)['@graph']; assert(graph.some((node: any) => node['@type'] === 'SoftwareApplication')); assert(graph.some((node: any) => node['@type'] === 'FAQPage'));
  evidence.publicMetadata = { pagination: true, filter: true, search: true, customRender: true, contentSemantics: true, faq: true };
  const cliEntry = await cli(['content', 'get', '--id', 'article-0']); assert(cliEntry.value.document); assert.equal(cliEntry.value.evidence[0].status, 'verified');
  assert.equal((await cli(['search-data', 'report'])).status, 'not-connected');
  const staleFile = join(output, 'stale-review.json'); await cli(['publication', 'preview', '--id', 'article-0', '--output', staleFile]);
  await api('entry', { value: { ...cliEntry.value, title: '预检后的修改' }, revision: cliEntry.revision });
  const rejected = await cli(['publish', '--input', staleFile, '--wait'], 1); assert(rejected.error || rejected.status === 'failed'); await publish(['--id', 'article-0']);
  evidence.reviewedCliPublication = { fullEntryRead: true, staleRejected: true, freshReviewPublished: true };
  const audit = await cli(['seo', 'audit', '--http']); assert.equal(audit.coverage.source, 'http-response'); assert.equal(audit.coverage.unavailable, 0); assert.equal(audit.coverage.excludedPrivate, 1); assert(audit.coverage.paginationChecked >= 1); assert(!audit.findings.some((finding: any) => finding.rule === 'orphan' && finding.path.startsWith('/posts/'))); evidence.httpAudit = audit.coverage;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  // Normal UA exercises the product's public analytics collector, which deliberately excludes HeadlessChrome.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' });
  await context.request.post(origin + '/api/admin/v1/login', { data: { password } });
  page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/admin/'); await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
  await page.getByLabel('搜索内容').fill('预检后的修改'); await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '预检后的修改', exact: true }) }).click();
  await page.getByText('搜索与分享', { exact: true }).click();
  await page.getByLabel('搜索标题', { exact: true }).fill('浏览器 SEO 标题'); await page.getByLabel('搜索摘要', { exact: true }).fill('浏览器填写的搜索摘要');
  await page.getByText('来源与核验（1）', { exact: true }).click(); await page.getByLabel('支持的说法').fill('浏览器复核的说法');
  assert.equal(await page.getByLabel('核验状态').inputValue(), 'pending'); await page.getByText('已保存', { exact: true }).waitFor(); await page.getByLabel('核验状态').selectOption('verified');
  await page.getByText('已保存', { exact: true }).waitFor();
  await page.mouse.move(2, 2); await page.screenshot({ path: join(output, 'editor-seo.png'), fullPage: true });
  await page.getByRole('button', { name: '发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor(); await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const published = await readPage('/posts/0/'); assert(published('title').text().includes('浏览器 SEO 标题')); assert(published('.entry-evidence').text().includes('浏览器复核的说法'));
  assert.equal(JSON.parse(published('script[data-weava-seo]').html()!)['@graph'].find((node: any) => node['@type'] === 'Article').citation[0].name, '来源文档');
  evidence.browserEditing = { savedAndPublished: true, changedClaimInvalidated: true, publicEvidenceAndMetadata: true };
  await page.getByRole('button', { name: '外观与导航', exact: true }).click(); await page.getByLabel('发布者身份').selectOption('Organization'); await page.getByLabel('发布者名称').fill('示例编辑部');
  await page.getByRole('combobox').filter({ has: page.locator('option[value="newsletter"]') }).selectOption('newsletter');
  await page.getByRole('button', { name: '发布设置', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor(); await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const newsletter = await readPage('/posts/0/'); assert.equal(newsletter('title').length, 1); assert(newsletter('title').text().includes('浏览器 SEO 标题')); assert(newsletter('.entry-evidence').text().includes('浏览器复核的说法')); assert(JSON.parse(newsletter('script[data-weava-seo]').html()!)['@graph'].some((node: any) => node['@type'] === 'Organization' && node.name === '示例编辑部'));
  evidence.newsletter = { sameMetadata: true, visibleEvidence: true, explicitPublisher: true };
  await page.getByRole('button', { name: '搜索与检查', exact: true }).click(); await page.getByRole('heading', { name: '搜索与内容检查' }).waitFor(); await page.getByRole('button', { name: '检查公开页面', exact: true }).click();
  await page.getByText(/实际 HTTP 响应：已检查/).waitFor({ timeout: 30000 });
  const dataset = { version: 1, id: 'browser-observations', kind: 'ai-observations', provider: 'manual', property: origin, start: '2026-01-01', end: '2026-01-01', collectedAt: '2026-01-01T12:00:00Z', expectedSamples: 2, rows: [{ id: 'one', platform: '验收平台', model: 'fixture-v1', query: '验收问题', answer: '验收回答', citations: [origin + '/posts/0/'], observedAt: '2026-01-01T12:00:00Z', locale: 'zh-CN', collectionMethod: 'manual', panelVersion: 'v1', status: 'answered' }] };
  await page.getByLabel('JSON', { exact: true }).fill(JSON.stringify(dataset)); await page.getByRole('button', { name: '校验并导入', exact: true }).click(); await page.getByText('已保存 1 个数据批次。', { exact: true }).waitFor();
  await page.mouse.move(2, 2); await page.screenshot({ path: join(output, 'search-report.png'), fullPage: true });
  const report = await cli(['search-data', 'report']); assert.equal(report.datasets[0].missing, 1); assert.equal(report.datasets[0].groups[0].citationRateAmongAnswers, 1);
  const input = join(output, 'dataset.json'); writeFileSync(input, JSON.stringify(dataset)); assert.equal((await cli(['search-data', 'import', '--input', input])).unchanged, true);
  evidence.observations = { browserImport: true, cliReadAndIdempotentImport: true, missingSamples: 1, fixtureOnly: true };
  await page.setViewportSize({ width: 390, height: 844 }); await page.mouse.move(2, 2); await page.screenshot({ path: join(output, 'search-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'search page overflows mobile viewport');
  const reader = await context.newPage(); await reader.goto(origin + '/'); await reader.evaluate(() => { document.dispatchEvent(new CustomEvent('weava:analytics', { detail: { name: 'signup:success' } })); });
  await reader.goto(origin + '/posts/0/'); await reader.getByRole('button', { name: '点赞', exact: true }).first().click(); await reader.waitForFunction(() => document.querySelector('[data-article-action="like"]')?.getAttribute('aria-pressed') === 'true');
  await reader.goto(origin + '/custom/'); await reader.goto(origin + '/posts/1/'); await reader.close();
  await fetch(origin + '/posts/0/', { headers: { 'User-Agent': 'OAI-SearchBot' } });
  let analytics: any;
  for (let i = 0; i < 20; i++) { analytics = await api('analytics'); if (analytics.actions.some((action: any) => action.name === 'signup:success') && analytics.pages.some((item: any) => item.path === '/')) break; await new Promise((done) => setTimeout(done, 250)); }
  assert(analytics.actions.some((action: any) => action.name === 'signup:success')); assert(analytics.actions.some((action: any) => action.name === 'article:like')); for (const path of ['/', '/posts/0/', '/custom/']) assert(analytics.pages.some((item: any) => item.path === path && item.views > 0)); assert(analytics.crawlers.some((item: any) => item.agent === 'oai-searchbot' && item.identity === 'declared-user-agent'));
  evidence.analytics = { allPageKinds: true, actionCaptured: true, declaredCrawlerSeparate: true, sources: analytics.sources.map((source: any) => source.channel) };
  assert.deepEqual(errors, []); evidence.passed = true;
} catch (error: any) {
  evidence.failed = error.message; if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
} finally {
  await browser?.close(); if (server.exitCode === null) { const closed = new Promise<void>((done) => server.once('exit', () => done())); server.kill(); await closed; }
  evidence.serviceStopped = true; evidence.browserErrors = errors;
  writeFileSync(join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
}
