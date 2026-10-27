import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { strict as assert } from 'node:assert';
const output = resolve('D:/Tools/cache/weava/browser-' + Date.now());
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const password = readFileSync('D:/Tools/weava/demo-owner-password.txt', 'utf8').trim();
const screenshots: string[] = [];
const shot = async (name: string) => {
  const path = join(output, name + '.png');
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
};
try {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('http://127.0.0.1:4322/');
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('h1').textContent(), '想法值得拥有\n自己的空间。');
  assert(!requests.some((u) => u.includes('/_admin/')));
  await shot('demo-home');
  await page.goto('http://127.0.0.1:4322/admin/');
  await page.getByLabel('站主密码').fill(password);
  await page.getByRole('button', { name: '进入网站', exact: true }).click();
  await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
  await shot('admin-library');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('内容标题').fill('浏览器验收文章');
  await page.getByLabel('内容摘要').fill('验证可视化、自动保存、预览和发布。');
  const editor = page.getByRole('textbox', { name: '正文编辑器' });
  await editor.waitFor();
  await editor.fill('中文可视化正文，包含表格、图片和代码。');
  await page.getByRole('button', { name: '表格', exact: true }).click();
  await page.locator('.visual-editor table').waitFor();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page
    .frameLocator('iframe[title="实际页面预览"]')
    .getByRole('heading', { name: '浏览器验收文章', exact: true })
    .waitFor();
  await shot('article-preview');
  await page.locator('.preview-modal').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByText('操作已完成', { exact: true }).waitFor({ timeout: 30000 });
  const path = await page
    .locator('.entry-settings label')
    .filter({ hasText: '网址' })
    .locator('input')
    .inputValue();
  await page.goto('http://127.0.0.1:4322' + path);
  await page.getByRole('heading', { name: '浏览器验收文章', exact: true }).waitFor();
  assert.equal(await page.locator('table').count(), 1);
  await shot('published-article');
  await page.goto('http://127.0.0.1:4322/admin/');
  await page.getByRole('button').filter({ hasText: '浏览器验收文章' }).click();
  await page.getByLabel('内容标题').fill('浏览器修改后的标题');
  await page.waitForTimeout(2200);
  const published = await page.request.get('http://127.0.0.1:4322' + path);
  assert((await published.text()).includes('浏览器验收文章'));
  assert(!(await published.text()).includes('<h1>浏览器修改后的标题</h1>'));
  await page.getByRole('button', { name: '历史版本', exact: true }).click();
  await page.locator('.history-row').first().waitFor();
  await page.locator('.modal').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal((await page.request.get('http://127.0.0.1:4322' + path)).status(), 404);
  await page.locator('.sidebar').getByRole('button', { name: '页面', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('内容标题').fill('浏览器验收页面');
  await page.getByLabel('区块类型').selectOption('hero');
  await page.getByRole('button', { name: '添加区块', exact: true }).click();
  await page
    .locator('.block-properties')
    .getByLabel('标题', { exact: true })
    .fill('无需重新构建的新页面');
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByText('操作已完成', { exact: true }).waitFor({ timeout: 30000 });
  await shot('page-builder');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(600);
  await shot('admin-narrow');
  await page.goto('http://127.0.0.1:4322/');
  await shot('demo-narrow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4323/');
  await page.waitForLoadState('domcontentloaded');
  await shot('crypto-home');
  assert.equal(await page.locator('.announcements-widget').count(), 0);
  await page.goto('http://127.0.0.1:4323/stocks/');
  await page.waitForTimeout(1500);
  await shot('crypto-stocks');
  await page.goto('http://127.0.0.1:4323/guides/invitation-codes/');
  await page.locator('h1').waitFor();
  await shot('crypto-article');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('crypto-narrow');
  assert.equal(errors.length, 0, errors.join('\n'));
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify({ passed: true, errors, screenshots }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, output, screenshots }));
} catch (error: any) {
  await shot('failure');
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify({ passed: false, error: error.message, errors, screenshots }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
