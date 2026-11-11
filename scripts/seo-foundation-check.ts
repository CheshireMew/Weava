import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { load } from 'cheerio';
import { Site } from '@weava/core';
import { entrySchema, typeSchema } from '@weava/contracts';

// One isolated site, one reusable production build; no real accounts or published site changes.
const framework = resolve(import.meta.dirname, '..');
const output = resolve(process.env.WEAVA_CHECK_OUTPUT ?? 'D:/Tools/cache/weava/tasks/seo-foundation-20261111');
const program = resolve(process.env.WEAVA_CHECK_BUILD ?? join(output, 'program'));
const root = join(output, 'site'); mkdirSync(root, { recursive: true });
const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as any).port; await new Promise<void>(done => listener.close(() => done()));
const origin = 'http://127.0.0.1:' + port;
const site = new Site(root); site.setOwner(randomBytes(24).toString('hex'));
site.saveType(typeSchema.parse({ id: 'post', label: '文章', fields: [], seoTemplates: { title: '{title} | {siteName}' } }), null);
for (let i = 0; i < 26; i++) site.saveEntry(entrySchema.parse({ id: 'article-' + i, kind: 'content', type: 'post', path: `/posts/${i}/`, title: '内容 ' + i,
  status: 'published', description: '说明与案例 ' + i, document: { version: 1, format: 'markdown', source: '## 使用方法\n\n这是用于实际 HTTP 和性能验证的正文。\n\n' + ('具体说明、实际操作和相关内容。\n\n').repeat(15) },
  ...(i === 0 ? { evidence: [{ id: 'source', claim: '待复核', status: 'pending' }] } : {}) }), null);
for (const value of [
  { id: 'home', path: '/', title: '首页', blocks: [{ id: 'list', type: 'content-list', props: { limit: 10 } }] },
  { id: 'catalog', path: '/catalog/', title: '资料', blocks: [{ id: 'list', type: 'collection', props: { presentation: 'catalog', limit: 10 } }] },
  { id: 'notes', path: '/notes/', title: '随笔', template: 'notes-feed' },
  { id: 'alternate', path: '/alternate/', title: '重复入口', seo: { canonical: '/posts/0/' } },
  { id: 'excluded', path: '/excluded/', title: '不索引', indexable: false },
  { id: 'private', path: '/private/', title: '私密', visibility: 'private' },
  { id: 'extension', path: '/extension/', title: '扩展元信息' },
  { id: 'doc-parent', path: '/docs/', title: '文档', documentation: { group: 'docs' } },
  { id: 'doc-child', path: '/docs/child/', title: '子文档', documentation: { group: 'docs', parentId: 'doc-parent' } },
]) site.saveEntry(entrySchema.parse({ kind: 'page', status: 'published', ...value }), null);
const settings = site.settings(); site.saveSettings({ ...settings.value, domain: origin, name: 'SEO 验证', navigation: [{ label: '首页', url: '/' }, { label: '资料', url: '/catalog/' }],
  extensions: { ...settings.value.extensions, notes: { path: '/notes/' } } }, settings.revision);
site.publish(); const token = site.cliToken(); site.close();
mkdirSync(join(root, 'extensions'), { recursive: true });
writeFileSync(join(root, 'extensions/index.mjs'), `export default () => ({id:'seo-foundation',apiVersion:1,metadata:entry=>entry?.id==='extension'?{canonical:'/posts/0/'}:null,route:request=>new URL(request.url).pathname==='/unlisted/'?new Response('<html><head><title>自定义页面</title><meta name="description" content="单独路由"><link rel="canonical" href="${origin}/unlisted/"></head><body><main><h1>自定义页面</h1><a href="/">首页</a></main></body></html>',{headers:{'Content-Type':'text/html'}}):null,render:entry=>entry?.id==='extension'?'<html><head></head><body><main><h1>扩展页面</h1><a href="/unlisted/">专用页面</a><a href="/catalog/">资料</a></main></body></html>':null});`);
writeFileSync(join(root, 'site.json'), JSON.stringify({ version: 1, port }));
if (!process.env.WEAVA_CHECK_BUILD) {
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(framework, 'scripts/build.ts')], { cwd: framework, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, WEAVA_BUILD_OUTPUT: program, WEAVA_BUILD_CACHE: join(output, 'astro-cache'), WEAVA_SITE: root, ASTRO_TELEMETRY_DISABLED: '1', TEMP: output, TMP: output } });
    child.once('error', reject); child.once('exit', done);
  });
  assert.equal(code, 0, 'production build');
}
const log = openSync(join(output, 'server.log'), 'a');
const server = spawn(process.execPath, [join(program, 'web/server/entry.mjs')], { cwd: framework, windowsHide: true, stdio: ['ignore', log, log],
  env: { ...process.env, WEAVA_SITE: root, WEAVA_FRAMEWORK: framework, WEAVA_ADMIN_DIST: join(program, 'admin'), WEAVA_WORKER: join(program, 'runtime/worker.mjs'),
    WEAVA_SOURCE_WORKER: '0', HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', TEMP: output, TMP: output } }); closeSync(log);
const report: Record<string, any> = { output, program, platform: process.platform, source: 'compiled HTTP server, worker and CLI; isolated fixture data', performance: [] };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function api(path: string, body?: any) {
  const response = await fetch(origin + '/api/admin/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json() as any; assert(response.ok, JSON.stringify(value)); return value;
}
async function task(value: any) {
  const deadline = Date.now() + 120000;
  for (;;) { assert(Date.now() < deadline, 'task exceeded check budget: ' + value.id); const job = await api('job/' + value.id); if (job.status === 'complete') return job.result;
    assert(['queued', 'running'].includes(job.status), JSON.stringify(job)); await new Promise(done => setTimeout(done, 100)); }
}
async function cli(args: string[]) {
  return new Promise<any>((done, reject) => {
    const child = spawn(process.execPath, [join(program, 'runtime/weava.mjs'), '--site', root, '--url', origin, ...args], { cwd: framework, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.once('error', reject); child.once('close', code => { try { assert.equal(code, 0, stdout + stderr); done(JSON.parse(stdout)); } catch (error) { reject(error); } });
  });
}
async function measure(path: string, theme: string) {
  const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), session = await context.newCDPSession(page);
  await session.send('Network.enable'); await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 625000, uploadThroughput: 250000 });
  await page.addInitScript(() => {
    const values = { lcp: 0, cls: 0, interaction: 0 }; (window as any).__seoMetrics = values;
    new PerformanceObserver(list => { for (const item of list.getEntries()) values.lcp = item.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const item of list.getEntries() as any) if (!item.hadRecentInput) values.cls += item.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => { for (const item of list.getEntries()) values.interaction = Math.max(values.interaction, item.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as any);
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const menu = page.locator('.menu-button,.mobile-menu').first(); if (await menu.isVisible()) { await menu.click(); await menu.click(); }
  await page.waitForTimeout(200);
  const values = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return { ...(window as any).__seoMetrics, ttfb: nav.responseStart, transferBytes: nav.transferSize + resources.reduce((sum, item) => sum + item.transferSize, 0),
      scripts: resources.filter(item => item.initiatorType === 'script').map(item => new URL(item.name).pathname), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert(!values.overflow, 'mobile overflow'); assert(!values.scripts.some((path: string) => /_admin|lexical|react/i.test(path)), 'admin code on public page');
  report.performance.push({ path, theme, ...values }); await context.close();
}
try {
  for (let i = 0; i < 160; i++) { if (server.exitCode !== null) throw new Error('Server exited'); try { if ((await fetch(origin + '/__health')).ok) break; } catch {} await new Promise(done => setTimeout(done, 100)); }
  assert((await fetch(origin + '/__health')).ok, 'server ready');
  let response = await fetch(origin + '/posts/0?utm_source=test', { redirect: 'manual' }); assert.equal(response.status, 301); assert.equal(response.headers.get('location'), '/posts/0/?utm_source=test');
  assert.equal((await fetch(origin + '/private/')).status, 404);
  const xml = await (await fetch(origin + '/sitemap.xml')).text();
  assert(!/alternate\/|excluded\/|private\/|extension\//.test(xml), 'sitemap uses final metadata');
  const before = await fetch(origin + '/sitemap.xml'); const etag = before.headers.get('etag'); assert(etag);
  assert.equal((await fetch(origin + '/sitemap.xml', { headers: { 'If-None-Match': etag } })).status, 304);
  const docs = load(await (await fetch(origin + '/docs/child/')).text()); assert(JSON.parse(docs('script[data-weava-seo]').html()!)['@graph'].some((node: any) => node['@type'] === 'BreadcrumbList'));
  const article = load(await (await fetch(origin + '/posts/0/')).text()); assert(article('title').text().includes('| SEO 验证'));
  assert.equal((await fetch(origin + '/notes/?page=2')).status, 200); assert.equal((await fetch(origin + '/notes/?page=999')).status, 404);
  const notes = load(await (await fetch(origin + '/notes/?page=2')).text()); assert.equal(notes('link[rel="canonical"]').attr('href'), origin + '/notes/?page=2');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await measure('/', 'base');
  await measure('/posts/0/', 'base');
  const updated = await api('settings'); await api('settings', { value: { ...updated.value, theme: 'library' }, revision: updated.revision }); await task(await api('publish', { scope: 'settings' }));
  const catalog = load(await (await fetch(origin + '/catalog/?page=2')).text()); assert.equal(catalog('link[rel="canonical"]').attr('href'), origin + '/catalog/page/2/');
  assert.equal((await fetch(origin + '/catalog/page/999/')).status, 404);
  await measure('/catalog/', 'library'); await measure('/posts/0/', 'library');
  let audit = await cli(['seo', 'audit', '--http', '--max-pages', '12']), batches = 1;
  assert(audit.crawl && !audit.crawl.complete);
  do { audit = await cli(['seo', 'audit', '--http', '--max-pages', '12', '--resume', audit.id]); batches++; assert(batches < 20); } while (!audit.crawl.complete);
  assert(audit.pages.some((page: any) => page.path === '/unlisted/'), 'extension route discovered');
  report.audit = { batches, coverage: audit.coverage, customPage: true, complete: audit.crawl.complete };
  await api('search-data/import', { version: 1, id: 'fixture', kind: 'search-performance', provider: 'gsc', property: origin, start: '2026-11-01', end: '2026-11-01', collectedAt: '2026-11-02T00:00:00Z',
    rows: [{ url: origin + '/posts/0/', date: '2026-11-01', query: 'topic', clicks: 1, impressions: 200, position: 12 }] });
  const insights = await cli(['seo', 'insights', '--start', '2026-11-01', '--end', '2026-11-01']); assert(insights.groups[0].suggestions.length >= 2); assert(insights.maintenance.some((item: any) => item.entryId === 'article-0'));
  const entry = await api('entry/article-0'); await api('entry', { value: { ...entry.value, title: '更新后的内容', path: '/posts/updated/' }, revision: entry.revision }); await task(await api('publish', { ids: ['article-0'] }));
  const changed = await fetch(origin + '/sitemap.xml', { headers: { 'If-None-Match': etag } }); assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), etag);
  report.insights = { cli: true, suggestions: insights.groups[0].suggestions.map((item: any) => item.kind), maintenance: true, fixtureOnly: true };
  report.http = { normalizedRedirect: true, privateExcluded: true, sitemapFinalMetadata: true, etag304: true, releaseInvalidation: true, notesBounds: true, collectionCanonical: true, breadcrumb: true, templates: true };
  report.performanceConditions = { viewport: '390×844', network: '5 Mbps, 80 ms latency, cold browser cache; external requests excluded', meaning: 'one local laboratory sample per page; interaction is a tested menu event, not field INP or ranking evidence' };
  report.passed = true;
} catch (error) { report.failure = error instanceof Error ? error.stack : String(error); throw error; }
finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = new Promise<void>(done => server.once('exit', () => done())); server.kill(); await exited; }
  report.serviceStopped = true; writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
