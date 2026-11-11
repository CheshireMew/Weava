import type { Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { entrySchema } from '@weava/contracts';

export function seedAuditRepairs(root: string) {
  writeFileSync(join(root, 'extensions', 'manifest.json'), JSON.stringify({ version: 1, extensions: [{ id: 'audit', file: 'audit.mjs' }] }));
  const source = `export default()=>({id:'audit',apiVersion:1,render:async(entry)=>{
    if(entry.id==='audit-log-failure'&&/worker\\.(mjs|ts)$/.test(process.argv[1]??'')){
      console.log('AUDIT_LOG_START\\n'+'诊断'.repeat(25000));throw new Error('AUDIT_LOG_TAIL');
    }return null;}});`;
  writeFileSync(join(root, 'extensions', 'audit.ts'), source);
}

export async function checkAuditRepairs({ page, api, origin, output }: {
  page: Page; api(action: string, value?: any): Promise<any>; origin: string; output: string;
}) {
  const until = async (condition: () => Promise<boolean>, label: string) => {
    for (let i = 0; i < 80; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
    throw new Error(label);
  };
  const select = async (title: string) => {
    await page.goto(origin + '/admin/');
    await page.getByLabel('搜索内容').fill(title);
    await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click();
    await page.getByLabel('内容标题').waitFor();
  };
  const original = await api('entry', { value: entrySchema.parse({ id: 'audit-repair', kind: 'content', type: 'post', title: '修复验收初稿', path: '/audit-repair/', categories: ['写作'], document: { version: 1, format: 'markdown', source: '浏览器修复验收正文。' } }), revision: null });
  await select('修复验收初稿');
  const layouts: any[] = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const checkbox = page.getByLabel('写作', { exact: true });
    const label = checkbox.locator('..');
    await label.scrollIntoViewIfNeeded();
    const dimensions = await label.evaluate((element) => {
      const input = element.querySelector('input')!, box = element.getBoundingClientRect(), control = input.getBoundingClientRect();
      return { rowHeight: box.height, checkboxHeight: control.height, direction: getComputedStyle(element).flexDirection, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(dimensions.direction, 'row'); assert.equal(dimensions.checkboxHeight, 16); assert(dimensions.rowHeight <= 48); assert.equal(dimensions.overflow, false);
    const before = await checkbox.isChecked(); await label.click({ position: { x: Math.min(80, (await label.boundingBox())!.width - 3), y: 12 } });
    assert.equal(await checkbox.isChecked(), !before);
    await checkbox.focus(); await checkbox.press('Space'); assert.equal(await checkbox.isChecked(), before);
    const titleHeight = (await page.getByLabel('内容标题').boundingBox())!.height;
    if (width === 390) assert(titleHeight >= 44);
    layouts.push({ width, ...dimensions, titleHeight, wholeRowClick: true, keyboardSpace: true });
    await page.screenshot({ path: join(output, `audit-terms-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('内容标题').fill('修复验收已保存');
  await until(async () => (await api('entry/audit-repair')).value.title === '修复验收已保存', 'edited title did not save');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.frameLocator('iframe[title="实际页面预览"]').getByRole('heading', { name: '修复验收已保存', exact: true }).waitFor();
  await page.getByRole('dialog', { name: '实际页面预览', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('dialog', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('dialog', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  assert((await fetch(origin + '/audit-repair/').then((response) => response.text())).includes('修复验收已保存'));
  const published = await api('entry/audit-repair');
  const comparison = await api(`revision/compare?id=audit-repair&from=${published.revision}&to=${original.revision}`);
  assert(comparison.changes.some((change: { path: string }) => change.path === '/title'));
  await api('restore', { id: 'audit-repair', revision: published.revision, version: original.revision });
  assert.equal((await api('entry/audit-repair')).value.title, '修复验收初稿');
  assert((await fetch(origin + '/audit-repair/').then((response) => response.text())).includes('修复验收已保存'));
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await until(async () => (await api('entry/audit-repair')).value.status === 'archived', 'archive did not finish');
  assert.equal((await fetch(origin + '/audit-repair/')).status, 404);
  for (const [path, text] of [['/rss.xml', '<rss'], ['/sitemap.xml', '<urlset'], ['/robots.txt', 'Sitemap:']]) {
    const response = await fetch(origin + path); assert.equal(response.status, 200); assert((await response.text()).includes(text));
  }

  await api('entry', { value: entrySchema.parse({ id: 'audit-log-failure', kind: 'content', type: 'post', title: '日志末尾验收', path: '/audit-log-failure/' }), revision: null });
  await select('日志末尾验收');
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.locator('.job-banner.failed').waitFor({ timeout: 30000 });
  await page.getByRole('dialog', { name: '发布变更', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  const error = page.locator('.error-banner'); if (await error.count()) await error.getByRole('button', { name: '关闭', exact: true }).click();
  const bannerLog = page.locator('.job-banner').getByRole('button', { name: '查看日志', exact: true });
  const inspectLog = async (name: string) => {
    const dialog = page.getByRole('dialog', { name: '任务日志', exact: true });
    await until(async () => (await dialog.getByLabel('日志内容').innerText()).includes('AUDIT_LOG_START'), 'log first page missing');
    await dialog.getByRole('button', { name: '下一页', exact: true }).click();
    const start = async () => Number((await dialog.locator('.job-log-controls span').innerText()).split('—')[0]);
    await until(async () => Math.floor(await start()/20000) === 1 && await dialog.getByLabel('日志内容').getAttribute('aria-busy') === 'false', 'next log page pending');
    assert(!(await dialog.getByLabel('日志内容').innerText()).includes('AUDIT_LOG_START'));
    await dialog.getByRole('button', { name: '末页', exact: true }).click();
    await until(async () => (await dialog.getByLabel('日志内容').innerText()).includes('AUDIT_LOG_TAIL'), 'log tail missing');
    const tailStart = await start();
    await dialog.getByRole('button', { name: '上一页', exact: true }).click();
    await until(async () => Math.floor(await start()/20000) === Math.floor(tailStart/20000)-1 && await dialog.getByLabel('日志内容').getAttribute('aria-busy') === 'false', 'previous log page pending');
    await dialog.getByRole('button', { name: '末页', exact: true }).click();
    await until(async () => (await dialog.getByLabel('日志内容').innerText()).includes('AUDIT_LOG_TAIL'), 'log tail missing');
    assert.equal(await page.locator('.error-banner').count(), 0);
    await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  };
  await bannerLog.click(); await inspectLog('audit-banner-log-tail');
  assert(await bannerLog.evaluate((element) => element === document.activeElement));
  await page.getByRole('button', { name: '运行与备份', exact: true }).click();
  const failedRow = page.locator('.release-list > div').filter({ hasText: 'AUDIT_LOG_TAIL' });
  await failedRow.getByRole('button', { name: '日志', exact: true }).click();
  await inspectLog('audit-operations-log-tail');
  await page.setViewportSize({ width: 390, height: 844 });
  await failedRow.getByRole('button', { name: '日志', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '任务日志', exact: true });
  await dialog.getByRole('button', { name: '末页', exact: true }).click();
  await until(async () => (await dialog.getByLabel('日志内容').innerText()).includes('AUDIT_LOG_TAIL'), 'mobile log tail missing');
  assert(await dialog.getByRole('button', { name: '关闭', exact: true }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(output, 'audit-log-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { layouts, saved: true, previewed: true, confirmationPublished: true, publicPageVisited: true, historicalDraftRestored: true, archived: true,
    systemEndpoints: true, longRealWorkerLog: true, bannerAndOperationsPagination: true, mobileCloseAccessible: true, logsAreSeparateFromErrors: true };
}
