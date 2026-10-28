import type { BrowserContext, Page } from 'playwright';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { strict as assert } from 'node:assert';
import { wordpressFixture } from '../tests/fixtures/wordpress-wxr.ts';

export async function checkImport({ origin, api, cli, page, context, output }: { origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[], instance?: string) => Promise<any>; page: Page; context: BrowserContext; output: string }) {
  const image = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#b48057' } }).png().toBuffer();
  let downloads = 0;
  const server = createServer((request, response) => { if (request.url?.endsWith('/photo.png')) { downloads++; response.setHeader('Content-Type', 'image/png'); response.end(image); } else { response.statusCode = 404; response.end(); } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const mediaUrl = 'http://127.0.0.1:' + (server.address() as any).port + '/wp-content/uploads/photo.png';
    const file = join(output, 'wordpress.xml'); writeFileSync(file, wordpressFixture({ mediaUrl }));
    const compiled = await cli(['migrate', 'wxr', '--input', file, '--dry-run', '--no-comments'], join(output, 'cli-wxr-site'));
    assert.equal(compiled.entries, 5); assert.equal(compiled.comments, 0); assert.equal(downloads, 0);
    await page.getByRole('button', { name: '运行与备份', exact: true }).click();
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles(file);
    await page.getByRole('button', { name: '预检导入', exact: true }).click();
    await page.getByRole('heading', { name: '预检结果', exact: true }).waitFor();
    assert((await page.locator('.import-report').innerText()).includes('页面 3'));
    assert.equal(downloads, 0);
    await page.locator('.import-report').getByText('原插件页面', { exact: true }).click();
    assert((await page.locator('.import-report').innerText()).includes('acf/map'));
    await page.screenshot({ path: join(output, 'wordpress-preflight.png'), fullPage: true });
    // A browser review must not authorize a later, changed site state.
    const settings = await api('settings'); await api('settings', { value: { ...settings.value, description: '预检之后的设置修改' }, revision: settings.revision });
    await page.getByRole('button', { name: '导入已预检内容', exact: true }).click();
    await page.locator('.import-manager [role="alert"]').getByText('来源文件、导入选项或站点内容已变化，请重新预检。', { exact: true }).waitFor();
    assert.equal((await api('entries')).filter((row: any) => row.id.startsWith('wordpress:')).length, 0);
    await page.getByRole('button', { name: '预检导入', exact: true }).click(); await page.getByRole('heading', { name: '预检结果', exact: true }).waitFor();
    await page.getByRole('button', { name: '导入已预检内容', exact: true }).click();
    await page.getByRole('heading', { name: '导入完成', exact: true }).waitFor({ timeout: 30000 });
    assert.equal(downloads, 1);
    const entries = (await api('entries')).filter((row: any) => row.id.startsWith('wordpress:'));
    assert.equal(entries.length, 5); assert.equal((await api('media')).filter((row: any) => row.value.name === 'photo.png').length, 1);
    assert.equal((await fetch(origin + '/hello/')).status, 404);
    await page.getByRole('button', { name: '发布全站工作稿', exact: true }).click();
    await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
    const visitor = await context.newPage(); await visitor.goto(origin + '/hello/');
    await visitor.getByRole('heading', { name: '来源文章', exact: true }).waitFor();
    assert.equal(await visitor.locator('main a[href="/about/#team"]').count(), 1);
    assert((await visitor.locator('main img').first().getAttribute('src'))!.startsWith('/media/'));
    await visitor.goto(origin + '/about/team/'); await visitor.getByRole('heading', { name: '团队页面', exact: true }).waitFor();
    assert((await visitor.locator('main').innerText()).includes('团队页面正文'));
    await visitor.goto(origin + '/about/'); assert((await visitor.locator('main').innerText()).includes('可复用正文'));
    await visitor.screenshot({ path: join(output, 'wordpress-page-published.png'), fullPage: true });
    await page.getByRole('button', { name: '页面', exact: true }).click(); await page.getByLabel('搜索内容').fill('原插件页面');
    await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '原插件页面', exact: true }) }).click();
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await page.getByText('请先检查来源功能的转换结果：原插件页面', { exact: true }).waitFor();
    assert.equal((await fetch(origin + '/contact/')).status, 404);
    assert.equal((await api('comments')).items.filter((comment: any) => comment.id.startsWith('wpcomment:')).length, 2);
    await visitor.close();
    return { compiledCliPreflight: true, browserPreflight: true, staleReviewRejected: true, workerImport: true, localMedia: true,
      separatePublication: true, pagesAndParents: true, reusableBlock: true, internalAnchors: true, originalPluginNeedsReview: true, comments: 2 };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
