import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const dir = 'D:/Tools/cache/weava/acceptance/final';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report: any = { passed: true, screenshots: [], errors: [] };
try {
  for (const [name, port] of [
    ['demo', 4322],
    ['crypto', 4323],
  ] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    const origin = 'http://127.0.0.1:' + port,
      requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(origin);
    assert(!requests.some((r) => r.includes('/_admin/') || /lexical|react-dom/i.test(r)));
    const home = dir + '/' + name + '-home.png';
    await page.screenshot({ path: home, fullPage: true });
    report.screenshots.push(home);
    if (name === 'demo') {
      await page.goto(origin + '/company/');
      await page.getByText('如何开始合作？', { exact: true }).waitFor();
      await page.screenshot({ path: dir + '/demo-company.png', fullPage: true });
    }
    await page.goto(origin + '/admin/');
    await page
      .getByLabel('站主密码')
      .fill(readFileSync('D:/Tools/weava/' + name + '-owner-password.txt', 'utf8').trim());
    await page.getByRole('button', { name: '进入网站', exact: true }).click();
    await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
    const admin = dir + '/' + name + '-admin.png';
    await page.screenshot({ path: admin, fullPage: true });
    report.screenshots.push(admin);
    const token = readFileSync(
        'E:/Code/WeavaSites/' + (name === 'demo' ? 'demo' : 'crypto-blacknico') + '/cli-token',
        'utf8',
      ),
      headers = { Authorization: 'Bearer ' + token };
    const state = (await (await fetch(origin + '/api/admin/v1/state', { headers })).json()) as any;
    if (name === 'demo') {
      assert.equal(state.entries.length, 13);
      assert.equal(state.entries.filter((e: any) => e.value.title.includes('验收')).length, 0);
    } else assert(state.themes.some((t: any) => t.id === 'crypto-blacknico'));
    await page.locator('.sidebar').getByRole('button', { name: '外观与导航', exact: true }).click();
    await page.getByRole('heading', { name: '主题', exact: true }).waitFor();
    if (name === 'crypto') {
      await page.getByRole('heading', { name: '平台与邀请设置', exact: true }).waitFor();
      assert.equal(
        await page
          .locator('select')
          .filter({ has: page.locator('option[value="crypto-blacknico"]') })
          .locator('option')
          .count(),
        2,
      );
    }
    const usage = (await (
      await fetch(origin + '/api/admin/v1/maintenance', { headers })
    ).json()) as any;
    assert(usage.databaseBytes > 0);
    assert(usage.media.count > 0);
    report[name] = {
      entries: state.entries.length,
      releases: state.releases.length,
      databaseBytes: usage.databaseBytes,
      media: usage.media.count,
      themes: state.themes,
    };
    await context.close();
  }
  assert.equal(report.errors.length, 0);
  writeFileSync(dir + '/result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
