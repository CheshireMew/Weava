import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createPortProbe } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { Site } from '@weava/core';
import { advertisementSlots, entrySchema, type Advertisements } from '@weava/contracts';

// Runs the current source in isolated development servers; no program bundle or real site is changed.
const framework = resolve(import.meta.dirname, '..');
const output = 'D:/Tools/cache/weava/advertisements-' + Date.now();
const root = join(output, 'site');
mkdirSync(output, { recursive: true });
const probe = createPortProbe();
await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((done) => probe.close(() => done()));
const origin = 'http://127.0.0.1:' + port;
const password = randomBytes(24).toString('hex');
const site = new Site(root);
site.setOwner(password);
site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
for (const [id, kind, path] of [['home', 'page', '/'], ['archive', 'page', '/archive/'], ['article', 'content', '/posts/advertisements/']] as const)
  site.saveEntry(entrySchema.parse({ id, kind, path, title: id === 'article' ? '广告功能验收文章' : id,
    status: 'published', ...(id === 'archive' ? { template: 'newsletter-archive' } : {}),
    document: { version: 1, format: 'markdown', source: '## 正文小节\n\n用于确认广告不会混入文章正文和目录。' } }), null);
const initial = site.settings();
site.saveSettings({ ...initial.value, domain: origin, navigation: [{ label: '首页', url: '/' }, { label: '归档', url: '/archive/' }] }, initial.revision);
site.publish();
const token = site.cliToken();
site.close();
writeFileSync(join(root, 'extensions/index.mjs'), `export default()=>({id:'ad-fixture',apiVersion:1,route(request){if(new URL(request.url).pathname!=='/ad-fixture.js')return null;return new Response("document.currentScript.closest('[data-ad-slot]').dataset.scriptLoaded='external'",{headers:{'Content-Type':'text/javascript'}})}});`);
const log = openSync(join(output, 'server.log'), 'a');
const server = spawn(process.execPath, [join(framework, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', String(port), '--host', '127.0.0.1'], {
  cwd: join(framework, 'apps/web'), windowsHide: true, stdio: ['ignore', log, log],
  env: { ...process.env, WEAVA_SITE: root, WEAVA_FRAMEWORK: framework, WEAVA_SOURCE_WORKER: '1',
    PORT: String(port), HOST: '127.0.0.1', ASTRO_TELEMETRY_DISABLED: '1', TEMP: output, TMP: output },
});
closeSync(log);
let admin: Awaited<ReturnType<typeof createViteServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { output, platform: process.platform, mode: 'source development servers, no package' };
async function api(action: string, body?: unknown) {
  const response = await fetch(origin + '/api/admin/v1/' + action, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json() as any;
  assert(response.ok, JSON.stringify(result));
  return result;
}
async function publish() {
  let job = await api('publish', { scope: 'settings' });
  const end = Date.now() + 30000;
  while (['queued', 'running'].includes(job.status) && Date.now() < end) {
    await new Promise((done) => setTimeout(done, 100));
    job = await api('job/' + job.id);
  }
  assert.equal(job.status, 'complete', job.message);
}
async function slots(page: Page, expected: string[]) {
  assert.deepEqual(await page.locator('[data-ad-slot]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ad-slot'))), expected);
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Astro exited: ' + join(output, 'server.log'));
    try { if ((await fetch(origin + '/__health')).ok) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  assert(ready, 'Astro did not start');
  admin = await createViteServer({ root: join(framework, 'apps/admin'), configFile: join(framework, 'apps/admin/vite.config.ts'),
    base: '/', cacheDir: join(output, 'vite-admin-cache'), server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin } } } });
  await admin.listen();
  const adminOrigin = 'http://127.0.0.1:' + (admin.httpServer!.address() as { port: number }).port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const visitors = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const editor = await owner.newPage(), visitor = await visitors.newPage();
  for (const page of [editor, visitor]) page.on('pageerror', (error) => errors.push(error.message));
  await visitor.goto(origin + '/posts/advertisements/');
  await slots(visitor, []);
  await editor.goto(adminOrigin + '/admin/?panel=appearance');
  await editor.getByLabel('站主密码', { exact: true }).fill(password);
  await editor.getByRole('button', { name: '进入网站', exact: true }).click();
  await editor.getByRole('heading', { name: '广告', exact: true }).waitFor();
  const advertisements: Advertisements = {};
  for (const { id, label } of advertisementSlots) {
    const html = `<style>#ad-${id}{background:#e5ede7;color:rgb(49,92,76);padding:20px;text-align:center}</style><div id="ad-${id}"><h2>${label}广告</h2><a href="https://example.com/?a=1&b=2">自定义广告链接</a><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='24'%3E%3Crect width='200' height='24' fill='%23315c4c'/%3E%3C/svg%3E" alt="广告图片" width="200" height="24"><iframe title="${label}嵌入广告" srcdoc="<p>嵌入广告内容</p>" style="display:block;width:100%;height:44px;border:0"></iframe></div><script>window.adSlots=(window.adSlots??[]).concat('${id}')</script><script src="/ad-fixture.js"></script>`;
    advertisements[id] = { enabled: true, html };
    await editor.getByLabel(`${label}广告 HTML 代码`, { exact: true }).fill(html);
    await editor.getByLabel(`启用${label}广告`, { exact: true }).check();
  }
  const saved = editor.waitForResponse((response) => response.url().endsWith('/api/admin/v1/settings') && response.request().method() === 'POST');
  await editor.getByRole('button', { name: '保存设置', exact: true }).click();
  assert((await saved).ok());
  assert.deepEqual((await api('settings')).value.advertisements, advertisements);
  await editor.reload();
  for (const { id, label } of advertisementSlots)
    assert.equal(await editor.getByLabel(`${label}广告 HTML 代码`, { exact: true }).inputValue(), advertisements[id]!.html);
  await visitor.reload();
  await slots(visitor, []);
  const preview = await owner.newPage();
  await preview.goto(origin + '/__preview/article');
  await slots(preview, ['siteTop', 'articleTop', 'articleBottom', 'siteBottom']);
  await preview.close();
  await editor.getByRole('button', { name: '发布设置', exact: true }).click();
  const dialog = editor.getByRole('dialog', { name: '发布变更', exact: true });
  await dialog.getByRole('button', { name: '确认发布', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  report.editing = { fourEditors: true, persistedExactly: true, draftIsolated: true, preview: true, publishedFromAdmin: true };

  for (const theme of ['weava', 'newsletter']) {
    const row = await api('settings');
    await api('settings', { value: { ...row.value, theme }, revision: row.revision });
    await publish();
    await visitor.goto(origin + '/posts/advertisements/');
    await slots(visitor, ['siteTop', 'articleTop', 'articleBottom', 'siteBottom']);
    assert.deepEqual(await visitor.evaluate(() => (window as any).adSlots), ['siteTop', 'articleTop', 'articleBottom', 'siteBottom']);
    assert.equal(await visitor.locator('[data-ad-slot][data-script-loaded="external"]').count(), 4);
    assert.equal(await visitor.locator('#ad-siteTop').evaluate((node) => getComputedStyle(node).color), 'rgb(49, 92, 76)');
    assert.equal(await visitor.frameLocator('iframe[title="网页顶部嵌入广告"]').getByText('嵌入广告内容').count(), 1);
    const order = await visitor.evaluate(() => {
      return [
        ['body > header', '[data-ad-slot="siteTop"]'], ['[data-ad-slot="siteTop"]', '#main'],
        ['#main', '[data-ad-slot="siteBottom"]'], ['[data-ad-slot="siteBottom"]', 'body > footer'],
        ['[data-ad-slot="articleTop"]', '.entry-template'], ['.entry-template', '[data-ad-slot="articleBottom"]'],
        ['[data-ad-slot="articleBottom"]', '.nl-comments'],
      ].every(([a, b]) => !!(document.querySelector(a)!.compareDocumentPosition(document.querySelector(b)!) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert(order, theme + ' advertisement order');
    if (theme === 'newsletter') assert(await visitor.evaluate(() =>
      document.querySelector('.nl-navigation')!.nextElementSibling === document.querySelector('[data-ad-slot="siteTop"]')!.parentElement));
    if (theme === 'newsletter') assert(!(await visitor.locator('.nl-toc').innerText()).includes('广告'));
    await visitor.screenshot({ path: join(output, theme + '-article-desktop.png'), fullPage: true });
    await visitor.setViewportSize({ width: 390, height: 844 });
    assert(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), theme + ' mobile overflow');
    await visitor.screenshot({ path: join(output, theme + '-article-mobile.png'), fullPage: true });
    await visitor.setViewportSize({ width: 1440, height: 1000 });
    for (const path of ['/', '/archive/', '/search/?q=正文', '/missing-ad-page/']) {
      await visitor.goto(origin + path);
      await slots(visitor, ['siteTop', 'siteBottom']);
    }
    assert(!(await fetch(origin + '/rss.xml').then((response) => response.text())).includes('data-ad-slot'));
    report[theme] = { fourSlots: true, correctOrder: true, inlineAndExternalScripts: true, htmlStylesAndIframe: true, pagesAndSearchAnd404: true, mobile: true };
  }
  let row = await api('settings');
  await api('settings', { value: { ...row.value, advertisements: { ...advertisements,
    siteTop: { ...advertisements.siteTop!, enabled: false }, articleBottom: { enabled: true, html: '  \n ' } } }, revision: row.revision });
  await visitor.goto(origin + '/posts/advertisements/');
  await slots(visitor, ['siteTop', 'articleTop', 'articleBottom', 'siteBottom']);
  await publish();
  await visitor.reload();
  await slots(visitor, ['articleTop', 'siteBottom']);
  row = await api('settings');
  const disabled = Object.fromEntries(advertisementSlots.map(({ id }) => [id, { ...advertisements[id]!, enabled: false }]));
  await api('settings', { value: { ...row.value, advertisements: disabled }, revision: row.revision });
  await publish();
  await visitor.reload();
  await slots(visitor, []);
  assert.equal(await visitor.locator('.weava-advertisement').count(), 0);
  await editor.reload();
  await editor.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('heading', { name: '广告', exact: true }).waitFor();
  for (const { id, label } of advertisementSlots) {
    assert.equal(await editor.getByLabel(`${label}广告 HTML 代码`, { exact: true }).inputValue(), advertisements[id]!.html);
    assert.equal(await editor.getByLabel(`启用${label}广告`, { exact: true }).isChecked(), false);
  }
  assert(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'admin mobile overflow');
  await editor.locator('.advertisement-settings').screenshot({ path: join(output, 'admin-mobile.png') });
  await editor.setViewportSize({ width: 1440, height: 1100 });
  await editor.locator('.advertisement-settings').screenshot({ path: join(output, 'admin-desktop.png') });
  report.disabled = { noMarkup: true, emptyHtmlHidden: true, codeRetained: true, unpublishedChangesIsolated: true };
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, report }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await admin?.close();
  server.kill();
}
