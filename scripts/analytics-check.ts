import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { strict as assert } from 'node:assert';
import { Site, Analytics } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { seedDemo } from '../packages/core/src/demo.ts';

const output = resolve('D:/Tools/cache/weava/analytics-browser-' + Date.now()),
  root = join(output, 'site');
mkdirSync(root, { recursive: true });
const password = crypto.randomUUID();
const server = createServer();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as any).port;
await new Promise<void>((r) => server.close(() => r()));
const url = 'http://127.0.0.1:' + port;
const site = new Site(root);
site.setOwner(password);
const settings = site.settings();
site.saveSettings({ ...settings.value, domain: url }, settings.revision);
mkdirSync(join(root, 'media'), { recursive: true });
writeFileSync(
  join(root, 'media', 'demo-landscape.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><path fill="#e7eee1" d="M0 0h1200v700H0z"/></svg>',
);
seedDemo(site);
site.saveEntry(
  entrySchema.parse({
    id: 'private-check',
    kind: 'page',
    title: '私密验证',
    path: '/private-check/',
    visibility: 'private',
    status: 'published',
  }),
  null,
);
site.publish();
const release = site.visibleRelease()!,
  paths = release.entries.filter((e) => e.visibility !== 'private').map((e) => e.path),
  token = site.cliToken();
site.close();
const analytics = new Analytics(root);
const checks: Record<string, any> = {};
const chrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const android =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36';
try {
  const cachedGeo = 'D:/Tools/cache/weava/analytics-assets/geoip-country.mmdb';
  if (existsSync(cachedGeo)) {
    mkdirSync(join(root, 'analytics'), { recursive: true });
    copyFileSync(cachedGeo, analytics.geo.file);
  }
  await analytics.geo.update(false);
  copyFileSync(analytics.geo.file, cachedGeo);
  checks.geo = analytics.geo.status();
  assert(checks.geo.available);
  checks.geoIpCountry = analytics.geo.country('8.8.8.8');
  assert.match(checks.geoIpCountry, /^[A-Z]{2}$/);
  assert.match(analytics.geo.country('2001:4860:4860::8888'), /^[A-Z]{2}$/);
  assert.equal(analytics.geo.country('127.0.0.1'), '');
  const originalGeo = readFileSync(analytics.geo.file),
    originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('temporary unavailable', { status: 503 });
    await assert.rejects(analytics.geo.update(), /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(readFileSync(analytics.geo.file), originalGeo);
  assert.equal(analytics.geo.country('8.8.8.8'), checks.geoIpCountry);
  assert(analytics.geo.status().available);
  assert.match(analytics.geo.status().error || '', /503/);
  checks.geoFailureKeepsCurrent = true;
  const ips = ['8.8.8.8', '1.1.1.1', '114.114.114.114', '77.88.8.8', '168.95.1.1', '80.80.80.80'];
  const refs = [
    'https://www.google.com/',
    'https://cn.bing.com/',
    'https://chatgpt.com/',
    'https://t.co/link',
    '',
    'https://claude.ai/',
  ];
  for (let day = 0; day < 30; day++)
    for (let index = 0; index < 6 + (day % 5); index++) {
      const visitor = 'sample-visitor-' + index,
        session = 'sample-session-' + day + '-' + index;
      const actualTs = new Date(Date.now() - day * 86400000 - index * 60000 - 600000).toISOString();
      for (let p = 0; p < 1 + (index % 3); p++) {
        const id = crypto.randomUUID(),
          path = paths[(index + p) % paths.length],
          referrer = p ? url + paths[index % paths.length] : refs[index % refs.length];
        analytics.collect(
          {
            id,
            kind: 'view',
            ts: new Date().toISOString(),
            visitor,
            session,
            path,
            referrer,
            campaign:
              index % 5 === 0 ? { source: 'weekly', medium: 'email', campaign: 'autumn' } : {},
          },
          [chrome, iphone, android][index % 3],
          new Set(paths),
          { ip: ips[index % ips.length], origin: url },
        );
        analytics.raw
          .prepare('UPDATE events SET ts=? WHERE id=?')
          .run(new Date(Date.parse(actualTs) + p * 45000).toISOString(), id);
        analytics.raw
          .prepare(
            'UPDATE page_activity SET last_seen=?,active_ms=?,scroll=?,closed=1 WHERE view_id=?',
          )
          .run(actualTs, (index + 1) * 7000, (index * 13) % 101, id);
      }
    }
  analytics.importViewTotals({
    sourceId: 'test-historical',
    capturedAt: new Date().toISOString(),
    entries: [{ entryId: 'home', path: '/', views: 1200 }],
  });
  checks.sampleViews = analytics.report(new URLSearchParams()).views;
} finally {
  analytics.close();
}
const child = spawn(process.execPath, [resolve('apps/web/dist/server/entry.mjs')], {
  cwd: resolve('.'),
  env: {
    ...process.env,
    WEAVA_SITE: root,
    WEAVA_FRAMEWORK: resolve('.'),
    WEAVA_TRUST_PROXY: '1',
    HOST: '127.0.0.1',
    PORT: String(port),
    ASTRO_TELEMETRY_DISABLED: '1',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
const tracking: any[] = [];
child.stdout.on('data', (c) => (log += c));
child.stderr.on('data', (c) => (log += c));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const request = async (path: string, data?: any, headers: Record<string, string> = {}) => {
  const response = await fetch(url + '/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert(response.ok, `${response.status} ${await response.clone().text()}`);
  return response;
};
const report = async () => (await (await request('admin/v1/analytics')).json()) as any;
try {
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = (await fetch(url + '/__health')).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const reader = await browser.newContext({
      userAgent: chrome,
      viewport: { width: 1280, height: 900 },
    }),
    page = await reader.newPage();
  await page.clock.install();

  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    tracking.push({ error: e.message });
  });
  page.on('request', (req) => {
    if (req.url().endsWith('/api/v1/analytics')) tracking.push({ sent: req.postData() });
  });
  page.on('requestfailed', (req) => {
    if (req.url().endsWith('/api/v1/analytics'))
      tracking.push({ failed: req.failure(), data: req.postData() });
  });
  page.on('requestfinished', async (req) => {
    if (req.url().endsWith('/api/v1/analytics')) {
      const res = await req.response();
      tracking.push({ payload: req.postData(), status: res?.status(), body: await res?.text() });
    }
  });
  const before = await report();
  const initialView = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/analytics') && r.status() === 200,
  );
  await page.goto(url + '/?utm_source=reader&utm_medium=email&utm_campaign=browser-check', {
    referer: 'https://chatgpt.com/',
  });
  await initialView;
  const first = await report();
  assert.equal(first.views, before.views + 1);
  assert.equal(first.sources.find((s: any) => s.name === 'reader')?.sessions, 1);
  const visitor = await page.evaluate(() => localStorage.getItem('weava-visitor'));
  await page.waitForTimeout(1200);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('weava:analytics', { detail: { name: 'test:success' } }),
    ),
  );
  await page.waitForTimeout(300);
  await page.getByRole('link', { name: '开始阅读', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  let after = await report();
  assert.equal(after.views, before.views + 2);
  assert.equal(after.visitors, before.visitors + 1);
  assert.equal(after.actions.find((r: any) => r.name === 'test:success')?.count, 1);
  await page.clock.fastForward(31000);
  await page.waitForTimeout(300);
  const history = (await (await request('admin/v1/analytics/visitor?id=' + visitor)).json()) as any;
  assert(
    history.events.some((e: any) => e.kind === 'view' && e.path === '/' && e.activeMs >= 1000),
  );
  assert(history.events.some((e: any) => e.kind === 'click'));
  assert.equal(((await (await request('admin/v1/analytics/realtime')).json()) as any).count, 1);
  await page.clock.fastForward(31000);
  await page.waitForTimeout(200);
  after = await report();
  assert.equal(after.views, before.views + 2);
  checks.browserTracking = {
    viewIncrement: 2,
    sameVisitor: true,
    click: true,
    action: true,
    visibleDwell: true,
    heartbeatDoesNotAddView: true,
  };
  const other = await reader.newPage();
  await other.bringToFront();
  await page.waitForTimeout(300);
  await page.close();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(((await (await request('admin/v1/analytics/realtime')).json()) as any).count, 0);
  checks.onlineHiddenPage = true;
  const prohibited = await request(
    'v1/analytics',
    {
      id: crypto.randomUUID(),
      kind: 'view',
      ts: new Date().toISOString(),
      visitor: 'private-test',
      session: 'private-test',
      path: '/private-check/',
    },
    { 'user-agent': chrome },
  );
  assert.equal(((await prohibited.json()) as any).accepted, 0);
  const bot = await request(
    'v1/analytics',
    {
      id: crypto.randomUUID(),
      kind: 'view',
      ts: new Date().toISOString(),
      visitor: 'bot-test',
      session: 'bot-test',
      path: '/',
    },
    { 'user-agent': 'Googlebot' },
  );
  assert.equal(((await bot.json()) as any).accepted, 0);
  const spoof = await request(
    'v1/analytics',
    {
      id: crypto.randomUUID(),
      kind: 'view',
      ts: new Date().toISOString(),
      visitor: 'geo-test',
      session: 'geo-test',
      path: '/',
    },
    { 'user-agent': chrome, 'x-forwarded-for': '8.8.8.8' },
  );
  assert.equal(((await spoof.json()) as any).accepted, 1);
  const geoDetail = (await (await request('admin/v1/analytics/visitor?id=geo-test')).json()) as any;
  assert.equal(geoDetail.events[0].country, checks.geoIpCountry);
  checks.apiGeo = true;
  const noStorage = await browser.newContext({ userAgent: chrome });
  await noStorage.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  const isolated = await noStorage.newPage();
  isolated.on('pageerror', (e) => errors.push(e.message));
  const noStorageBefore = (await report()).views;
  await isolated.goto(url + '/');
  await isolated.waitForLoadState('networkidle');
  assert.equal((await report()).views, noStorageBefore + 1);
  await noStorage.close();
  checks.storageBlocked = true;
  const retryContext = await browser.newContext({ userAgent: chrome });
  const retryPage = await retryContext.newPage();
  const retryBefore = (await report()).views;
  await retryPage.route('**/api/v1/analytics', (route) => route.abort());
  await retryPage.goto(url + '/');
  await retryPage.waitForLoadState('networkidle');
  assert.equal((await report()).views, retryBefore);
  await retryPage.unroute('**/api/v1/analytics');
  await retryPage.goto(url + '/blog/');
  await retryPage.waitForLoadState('networkidle');
  assert.equal((await report()).views, retryBefore + 2);
  await retryContext.close();
  checks.offlineRetry = true;
  const privacy = await browser.newContext({ userAgent: chrome });
  await privacy.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));
  const privacyPage = await privacy.newPage();
  const privacyBefore = (await report()).views;
  await privacyPage.goto(url + '/');
  await privacyPage.waitForLoadState('networkidle');
  assert.equal((await report()).views, privacyBefore);
  await privacy.close();
  checks.dnt = true;
  const admin = await browser.newContext({
    userAgent: chrome,
    viewport: { width: 1600, height: 1200 },
  });
  const dashboard = await admin.newPage();
  await dashboard.clock.install();
  dashboard.on('pageerror', (e) => errors.push(e.message));
  dashboard.on('console', (message) => {
    if (message.type() === 'error' && /same key|unique.*key/i.test(message.text()))
      errors.push(message.text());
  });
  await dashboard.goto(url + '/admin/');
  await dashboard.getByLabel('站主密码').fill(password);
  await dashboard.getByRole('button', { name: '进入网站', exact: true }).click();
  await dashboard
    .locator('.sidebar')
    .getByRole('button', { name: '访问统计', exact: true })
    .click();
  await dashboard.getByRole('heading', { name: '全球访客分布', exact: true }).waitFor();
  const trafficCard = dashboard
    .locator('.analytics-card')
    .filter({ has: dashboard.getByRole('heading', { name: '流量趋势', exact: true }) });
  await dashboard.mouse.move(0, 0);
  const displayedReport = await report();
  assert.equal(
    await trafficCard
      .locator('.analytics-legend button')
      .filter({ hasText: /^访客/ })
      .locator('strong')
      .innerText(),
    String(displayedReport.visitors),
    '图例访客必须是区间去重人数',
  );
  const todayResponse = dashboard.waitForResponse(
    (r) => r.url().includes('/api/admin/v1/analytics?') && r.ok(),
  );
  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  await todayResponse;
  await dashboard.getByRole('button', { name: '查询', exact: true }).waitFor({ state: 'visible' });
  await dashboard.mouse.move(0, 0);
  assert(
    (await trafficCard.locator('svg circle[data-series]').count()) >= 2,
    '单日趋势应显示数据点',
  );
  await trafficCard.screenshot({ path: join(output, 'single-day.png') });
  const monthResponse = dashboard.waitForResponse(
    (r) => r.url().includes('/api/admin/v1/analytics?') && r.ok(),
  );
  await dashboard.getByRole('button', { name: '近 30 天', exact: true }).click();
  await monthResponse;
  checks.trendTotalsAndSingleDay = true;
  for (const name of [
    '流量概览',
    '流量趋势',
    '搜索与 AI 来源趋势',
    '页面排行',
    '访问来源',
    '国家 / 地区',
    '浏览器',
    '操作系统',
    '设备类型',
    '设备型号',
    '最活跃访客',
    '最新访客',
    '当前在线',
    '链接点击',
    '关键动作',
    '累计浏览',
  ])
    assert(await dashboard.getByRole('heading', { name, exact: true }).count(), name);
  await dashboard.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await dashboard.screenshot({ path: join(output, 'desktop-top.png') });
  const countryCard = dashboard
    .locator('.analytics-card')
    .filter({ has: dashboard.getByRole('heading', { name: '国家 / 地区', exact: true }) });
  const filtered = dashboard.waitForResponse(
    (r) => r.url().includes('/api/admin/v1/analytics?') && r.status() === 200,
  );
  await countryCard.getByRole('button').first().click();
  await filtered;
  await dashboard
    .locator('.analytics-filter-tags')
    .getByRole('button', { name: '清除筛选' })
    .click();
  await dashboard.waitForTimeout(300);
  await dashboard
    .locator('.analytics-card')
    .filter({ has: dashboard.getByRole('heading', { name: '最活跃访客', exact: true }) })
    .getByRole('button')
    .filter({ hasText: 'sample-v' })
    .first()
    .click();
  await dashboard.getByRole('dialog', { name: '访客访问记录' }).waitFor();
  await dashboard.getByRole('dialog').getByText('正在读取访问记录…').waitFor({ state: 'hidden' });
  assert((await dashboard.getByRole('dialog').locator('tbody tr').count()) > 0);
  await dashboard.screenshot({ path: join(output, 'visitor.png'), fullPage: true });
  await dashboard.getByLabel('关闭访客记录').click();
  const statusOfGeo = (await (await request('admin/v1/analytics/geo')).json()) as any;
  await dashboard.route('**/api/admin/v1/analytics/geo', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ json: { ...statusOfGeo, updating: true } });
    else await route.fallback();
  });
  let geoPolls = 0;
  let pendingGeo: any;
  await dashboard.route('**/api/admin/v1/analytics/geo', async (route) => {
    if (route.request().method() === 'GET') {
      geoPolls++;
      pendingGeo = route;
    } else await route.fallback();
  });
  await dashboard.getByRole('button', { name: '更新地区库', exact: true }).click();
  await dashboard.clock.runFor(2100);
  await dashboard.waitForFunction(
    () => document.querySelector('.analytics-geo-status button')?.textContent === '正在下载…',
  );
  await dashboard.clock.fastForward(8000);
  assert.equal(geoPolls, 1, '地区库状态请求未结束时不能重叠轮询');
  await pendingGeo.fulfill({ json: { ...statusOfGeo, updating: false } });
  await dashboard.getByRole('button', { name: '更新地区库', exact: true }).waitFor();
  await dashboard.unroute('**/api/admin/v1/analytics/geo');
  await dashboard.route('**/api/admin/v1/analytics/realtime**', (route) =>
    route.fulfill({ status: 503, json: { error: '模拟实时统计连接中断' } }),
  );
  await dashboard.clock.runFor(15100);
  await dashboard.getByText(/实时数据更新失败/).waitFor();
  await dashboard.unroute('**/api/admin/v1/analytics/realtime**');
  await dashboard.getByRole('button', { name: '重试实时统计', exact: true }).click();
  await dashboard.getByText(/实时数据更新失败/).waitFor({ state: 'hidden' });
  checks.pollingFailureAndRecovery = true;
  await dashboard.route('**/api/admin/v1/analytics?*', (route) =>
    route.fulfill({ status: 503, json: { error: '模拟报表查询失败' } }),
  );
  await dashboard.getByRole('button', { name: '近 7 天', exact: true }).click();
  await dashboard.getByRole('alert').filter({ hasText: '模拟报表查询失败' }).waitFor();
  assert.equal(await dashboard.getByRole('heading', { name: '流量趋势', exact: true }).count(), 0);
  assert.equal(
    await dashboard.locator('.analytics-actions a').getAttribute('href'),
    null,
    '查询失败不能导出与展示不一致的结果',
  );
  await dashboard.unroute('**/api/admin/v1/analytics?*');
  await dashboard.getByRole('button', { name: '重试', exact: true }).click();
  await dashboard.getByRole('heading', { name: '流量趋势', exact: true }).waitFor();
  const restoreMonth = dashboard.waitForResponse(
    (r) => r.url().includes('/api/admin/v1/analytics?') && r.ok(),
  );
  await dashboard.getByRole('button', { name: '近 30 天', exact: true }).click();
  await restoreMonth;
  checks.failedQueryRecovery = true;
  for (const dataset of [
    'pages',
    'daily',
    'sources',
    'countries',
    'browsers',
    'os',
    'devices',
    'models',
    'visitors',
    'links',
    'actions',
    'campaigns',
    'crawlers',
    'lifetime',
  ]) {
    const exported = await request('admin/v1/analytics/export?dataset=' + dataset);
    assert(exported.headers.get('content-type')?.includes('csv'));
  }
  const downloadPromise = dashboard.waitForEvent('download');
  await dashboard.getByRole('link', { name: 'CSV', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(join(output, 'pages.csv'));
  assert(readFileSync(join(output, 'pages.csv'), 'utf8').includes('views'));
  await dashboard.getByLabel('排除本机后续访问').check();
  const excludedBefore = (await report()).views,
    excludedPage = await admin.newPage();
  await excludedPage.goto(url + '/');
  await excludedPage.waitForLoadState('networkidle');
  assert.equal((await report()).views, excludedBefore);
  await excludedPage.close();
  await dashboard.getByLabel('排除本机后续访问').uncheck();
  checks.localExclusion = true;
  const cli = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [resolve('dist/weava.mjs'), '--site', root, '--url', url, 'analytics', ...args],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert(
    cli(['report', '--channel', 'ai-referral']).sources.every(
      (s: any) => s.channel === 'ai-referral',
    ),
  );
  assert.equal(cli(['visitor', '--id', String(visitor)]).id, visitor);
  assert(cli(['geo-status']).available);
  assert.equal(
    cli(['export', '--dataset', 'countries', '--output', join(output, 'cli-countries.csv')])
      .dataset,
    'countries',
  );
  checks.cli = true;
  await dashboard.getByLabel('来源筛选').selectOption('ai-referral');
  await dashboard.waitForTimeout(300);
  assert(
    await dashboard.locator('.analytics-filter-tags').getByText('AI 来源', { exact: true }).count(),
  );
  await dashboard
    .locator('.analytics-filter-tags')
    .getByRole('button', { name: '清除筛选' })
    .click();
  await dashboard.waitForTimeout(300);
  await dashboard.setViewportSize({ width: 390, height: 844 });
  await dashboard.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  await dashboard.screenshot({ path: join(output, 'mobile-top.png') });
  assert(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.dashboard = {
    cards: true,
    filter: true,
    visitorDetails: true,
    exports: 14,
    mobileNoOverflow: true,
  };
  await dashboard.getByLabel('开始日期').fill('2020-01-01');
  await dashboard.getByLabel('结束日期').fill('2020-01-01');
  await dashboard.getByRole('button', { name: '查询', exact: true }).click();
  await dashboard.waitForTimeout(300);
  assert((await dashboard.getByText('所选范围内暂无访问记录。').count()) > 0);
  await dashboard.screenshot({ path: join(output, 'empty.png'), fullPage: true });
  checks.emptyState = true;
  assert.deepEqual(errors, []);
  checks.browserErrors = errors;
  writeFileSync(
    join(output, 'results.json'),
    JSON.stringify({ ok: true, url, output, checks }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, output, checks }));
} finally {
  await browser?.close();
  child.kill();
  writeFileSync(join(output, 'server.log'), log);
  writeFileSync(join(output, 'tracking.json'), JSON.stringify(tracking, null, 2));
}
