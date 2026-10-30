import type { Page } from 'playwright';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

export async function checkAuthoringTools({ origin, api, cli, page, output }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[]) => Promise<any>; page: Page; output: string;
}) {
  await api('types', { value: { id: 'authoring-note', label: '写作笔记', template: 'article', pathPrefix: '/notes/', fields: [{ key: 'topic', label: '主题', type: 'select', options: ['代码', '写作'], filterable: true, defaultValue: '写作' }] }, revision: null });
  const source = await api('entries/create', { kind: 'content', type: 'authoring-note', title: '模板源内容' });
  const second = await api('entries/create', { kind: 'content', type: 'authoring-note', title: '另一份笔记' });
  await api('entry', { value: { ...source.value, document: { version: 1, format: 'markdown', source: '# 固定提纲\n\n## 正文要点' } }, revision: source.revision });
  await page.goto(origin + '/admin/');
  await page.getByLabel('筛选内容类型').selectOption('authoring-note');
  await page.getByLabel('内容状态', { exact: true }).selectOption('draft');
  await page.getByLabel('筛选主题', { exact: true }).selectOption('写作');
  await page.getByRole('button', { name: '保存当前筛选', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '保存筛选', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('写作笔记草稿');
  await dialog.getByRole('button', { name: '保存筛选', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const view = (await api('authoring/views')).find((row: any) => row.value.name === '写作笔记草稿'); assert(view);
  await page.getByLabel('筛选内容类型').selectOption('post');
  await page.getByLabel('常用筛选').selectOption(view.id);
  await page.getByLabel('筛选主题', { exact: true }).waitFor(); assert.equal(await page.getByLabel('筛选主题', { exact: true }).inputValue(), '写作');
  await page.waitForFunction(() => document.querySelectorAll('.entry-list > button').length === 2);
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '模板源内容', exact: true }) }).click();
  await page.getByRole('button', { name: '保存为新建模板', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '保存新建模板', exact: true });
  await dialog.getByLabel('模板名称', { exact: true }).fill('笔记提纲');
  await dialog.getByRole('button', { name: '保存模板', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const template = (await api('authoring/templates')).find((row: any) => row.value.name === '笔记提纲'); assert(template);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建内容', exact: true });
  await dialog.locator('select').selectOption(template.id); await dialog.getByRole('button', { name: '新建', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const entries = (await api('entries/query?type=authoring-note')).items;
  const copy = entries.find((row: any) => row.id !== source.id && row.id !== second.id); assert(copy);
  const content = await api('entry/' + copy.id);
  assert.equal(content.value.document.source, '# 固定提纲\n\n## 正文要点'); assert.equal(content.value.status, 'draft');
  assert.notEqual(content.value.path, source.value.path);
  const cliCopy = await cli(['content', 'new', '--type', 'authoring-note', '--template', template.id, '--title', 'CLI 提纲']);
  assert.equal(cliCopy.value.title, 'CLI 提纲'); assert.equal(cliCopy.value.document.source, content.value.document.source);
  await page.screenshot({ path: join(output, 'authoring-tools.png'), fullPage: true });
  await page.getByLabel('常用筛选').selectOption(view.id);
  await page.locator('.saved-view-controls').getByRole('button', { name: '归档', exact: true }).click();
  await page.locator('.saved-view-controls').getByLabel('显示归档', { exact: true }).check();
  await page.getByLabel('常用筛选').selectOption(view.id);
  await page.locator('.saved-view-controls').getByRole('button', { name: '恢复', exact: true }).click();
  assert.equal((await api('authoring/views')).find((row: any) => row.id === view.id).value.archived, false);
  return { namedViews: true, restoredFilters: true, archiveAndRestore: true, createTemplateFromEditor: true, independentTemplateDraft: true, cliTemplateCreation: true };
}
