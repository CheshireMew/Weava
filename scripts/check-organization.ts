import type { Page, BrowserContext } from 'playwright';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

export async function checkOrganization({ origin, api, cli, page, context, output }: { origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[]) => Promise<any>; page: Page; context: BrowserContext; output: string }) {
  await api('types', { value: { id: 'tool', label: '工具资源', pathPrefix: '/tools/', template: 'resource', fields: [{ key: 'platform', label: '平台', type: 'select', options: ['Windows', 'Linux'], filterable: true }, { key: 'free', label: '免费', type: 'boolean', filterable: true }] }, revision: null });
  for (let index = 0; index < 5; index++) await api('entry', { value: { id: 'tool-' + index, type: 'tool', kind: 'content', title: '工具资源 ' + index, path: '/tools/' + index + '/', status: 'published', fields: { platform: index < 3 ? 'Windows' : 'Linux', free: index % 2 === 0 }, document: { version: 1, format: 'markdown', source: '资源正文' } }, revision: null });
  await api('entry', { value: { id: 'tools-page', kind: 'page', title: '工具目录', path: '/tools/', status: 'published', blocks: [{ id: 'heading', type: 'hero', props: { title: '工具目录' } }, { id: 'list', type: 'content-list', props: { contentType: 'tool', filters: 'show', limit: 1 } }] }, revision: null });
  let job = await api('publish', {}); while (['running','queued'].includes(job.status)) { await new Promise((resolve) => setTimeout(resolve,300)); job = await api('job/' + job.id); } assert.equal(job.status, 'complete');
  const visitor = await context.newPage(); await visitor.goto(origin + '/tools/');
  await visitor.getByLabel('平台', { exact: true }).selectOption('Windows'); await visitor.getByLabel('免费', { exact: true }).selectOption('true'); await visitor.getByRole('button', { name: '筛选', exact: true }).click();
  assert.equal(await visitor.locator('main .card h3').innerText(), '工具资源 0');
  await visitor.getByRole('link', { name: '下一页', exact: true }).click(); assert.equal(await visitor.locator('main .card h3').innerText(), '工具资源 2');
  assert(visitor.url().includes('field.platform=Windows')); assert(visitor.url().includes('field.free=true'));
  const publicQuery = await fetch(origin + '/api/v1/content?type=tool&field.platform=Windows&field.free=true').then((response) => response.json()) as any[]; assert.equal(publicQuery.length,2);
  const fromCli = await cli(['content', 'list', '--type', 'tool', '--field', 'platform=Windows', 'free=true']); assert.equal(fromCli.total, 2);
  await page.goto(origin + '/admin/'); await page.getByRole('heading', { name: '内容', exact: true }).waitFor();
  await page.getByLabel('筛选内容类型').selectOption('tool'); await page.getByLabel('筛选平台').selectOption('Windows'); await page.getByLabel('筛选免费').selectOption('true');
  await page.waitForFunction(() => document.querySelectorAll('.entry-list button').length === 2);
  await page.screenshot({ path: join(output, 'resource-filters-admin.png'), fullPage: true });
  await visitor.screenshot({ path: join(output, 'resource-filters-public.png'), fullPage: true });
  const settings = await api('settings'); await api('settings', { value: { ...settings.value, name: '分类操作不发布这个站名' }, revision: settings.revision });
  const row = await api('entry/tool-0'); await api('entry', { value: { ...row.value, title: '分类操作不发布这个标题' }, revision: row.revision });
  await page.getByRole('button', { name: '分类与标签', exact: true }).click();
  await page.getByRole('button', { name: '新建分类', exact: true }).click(); await page.getByLabel('分类或标签名称', { exact: true }).fill('工具资料'); await page.getByLabel('分类或标签网址标识', { exact: true }).fill('tool-guides');
  const writing = (await api('terms')).find((row: any) => row.value.label === '写作'); await page.getByLabel('上级分类', { exact: true }).selectOption(writing.id);
  await page.getByRole('button', { name: '保存分类或标签', exact: true }).click(); await page.locator('.taxonomy-list').getByRole('button', { name: '写作 › 工具资料', exact: true }).waitFor();
  await page.getByLabel('分类或标签名称', { exact: true }).fill('工具教程');
  await page.getByRole('button', { name: '发布分类和标签', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout:30000 });
  const publicItems = await fetch(origin + '/api/v1/content?type=tool').then((response) => response.json()) as any[]; assert.equal(publicItems.find((item) => item.id === row.id).title, '工具资源 0');
  const publicHtml = await fetch(origin + '/tools/').then((response) => response.text()); assert(!publicHtml.includes('分类操作不发布这个站名'));
  await page.getByRole('button', { name: '内容', exact: true }).click(); await page.getByLabel('搜索内容').fill('分类操作不发布这个标题');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '分类操作不发布这个标题', exact: true }) }).click();
  await page.getByLabel('写作 › 工具教程', { exact: true }).check(); await page.getByText('已保存', { exact: true }).waitFor();
  const child = (await api('terms')).find((row: any) => row.value.label === '工具教程'); assert.deepEqual((await api('entry/tool-0')).value.termIds.categories, [child.id]);
  await visitor.close();
  return { publicFormPagination: true, declaredApiFilters: true, cliFields: true, adminFields: true, taxonomyHierarchyEditor: true, stablePicker: true, taxonomyPublicationExcludesDraftSettingsAndContent: true };
}
