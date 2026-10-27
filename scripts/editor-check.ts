import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { entrySchema } from '@weava/contracts';
const origin = 'http://127.0.0.1:4322',
  token = readFileSync('E:/Code/WeavaSites/demo/cli-token', 'utf8'),
  password = readFileSync('D:/Tools/weava/demo-owner-password.txt', 'utf8').trim(),
  id = 'editor-check-' + Date.now(),
  title = '编辑模式验收 ' + id;
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
async function api(path: string, body?: any) {
  const r = await fetch(origin + '/api/admin/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(r.ok, await r.clone().text());
  return r.json() as any;
}
await api('entry', {
  value: entrySchema.parse({
    id,
    title,
    kind: 'content',
    type: 'post',
    path: '/blog/' + id + '/',
    document: {
      version: 1,
      format: 'markdown',
      source:
        '## 中文标题\n\n正文段落。\n\n| 项目 | 值 |\n| --- | --- |\n| 中文 | 测试 |\n\n![图片](/media/demo-landscape.svg)\n\n```ts\nconst value = 1;\n```',
    },
  }),
  revision: null,
});
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext();
await context.request.post(origin + '/api/admin/v1/login', { data: { password } });
const page = await context.newPage();
const open = async (p: any) => {
  await p.goto(origin + '/admin/');
  await p.getByRole('button').filter({ hasText: title }).click();
};
try {
  await open(page);
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click();
  assert.equal(await page.locator('.visual-editor table').count(), 1);
  assert.equal(await page.locator('.visual-editor img').count(), 1);
  assert((await page.locator('.visual-editor').innerText()).includes('const value = 1;'));
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  let source = await page.getByLabel('正文源码').inputValue();
  assert(source.includes('![图片]'));
  assert(source.includes('| 中文 | 测试 |'));
  assert(source.includes('const value = 1;'));
  await page.waitForTimeout(1800);
  await page.route('**/api/admin/v1/entry', (route) => route.abort());
  const recovered = '## 浏览器恢复正文\n\n断线输入不会消失。';
  await page.getByLabel('正文源码').fill(recovered);
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button').filter({ hasText: title }).click();
  await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click();
  assert.equal(await page.getByLabel('正文源码').inputValue(), recovered);
  await page.unroute('**/api/admin/v1/entry');
  await page.waitForTimeout(1800);
  const second = await context.newPage();
  await open(second);
  await page.getByLabel('内容标题').fill(title + ' 第一个窗口');
  await page.waitForTimeout(1800);
  await second.getByLabel('内容标题').fill(title + ' 第二个窗口');
  await second.getByRole('alert').filter({ hasText: '其他窗口' }).waitFor({ timeout: 10000 });
  assert.equal((await api('entry/' + id)).value.title, title + ' 第一个窗口');
  const report = {
    passed: true,
    checks: ['chinese-table-image-code-roundtrip', 'offline-local-recovery', 'two-window-conflict'],
  };
  writeFileSync('D:/Tools/cache/weava/acceptance/editor.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const row = await api('entry/' + id);
  await api('withdraw', { id, revision: row.revision, archive: true });
  await browser.close();
}
