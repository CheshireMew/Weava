import type { Page } from 'playwright';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function checkContentModels({ origin, api, cli, page, output }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[]) => Promise<any>; page: Page; output: string;
}) {
  await api('types', { value: { id: 'cms-client', label: '客户资料', pathPrefix: '/clients/', template: 'article', fields: [{ key: 'active', label: '可用', type: 'boolean' }] }, revision: null });
  const definition = { id: 'cms-project', label: '项目资料', pathPrefix: '/projects/', template: 'article', fields: [
    { key: 'rating', label: '评分', type: 'number', min: 0, max: 10, defaultValue: 3 },
    { key: 'external', label: '外部项目', type: 'boolean', defaultValue: false },
    { key: 'url', label: '外部网址', type: 'text', required: true, condition: { field: 'external', operator: 'equals', value: true } },
    { key: 'client', label: '所属客户', type: 'reference', referenceTypes: ['cms-client'], referenceFilters: { active: true } },
    { key: 'team', label: '团队', type: 'group', multiple: true, summaryField: 'name', fields: [{ key: 'name', label: '姓名', type: 'text', required: true }] },
  ], admin: { fields: [{ key: 'rating', width: 'half' }, { key: 'external', width: 'half' }, { key: 'url', width: 'full' }, { key: 'client', width: 'full' }, { key: 'team', width: 'full' }], columns: ['title', 'status', 'rating'], sort: '-title' } };
  await api('types', { value: definition, revision: null });
  for (const [id, active] of [['cms-client-a', true], ['cms-client-b', false]] as const) await api('entry', { value: { id, kind: 'content', type: 'cms-client', title: id, path: '/' + id + '/', fields: { active } }, revision: null });
  const record = await api('entry', { value: { id: 'cms-project-a', kind: 'content', type: 'cms-project', title: '模型浏览器样例', path: '/cms-project-a/', fields: { team: [{ name: '甲' }, { name: '乙' }] } }, revision: null });
  assert.equal(record.value.fields.rating, 3);
  const input = join(output, 'candidate-check.json'); writeFileSync(input, JSON.stringify(record.value));
  assert.equal((await cli(['content', 'check', '--input', input])).valid, true);
  await page.goto(origin + '/admin/');
  await page.getByLabel('搜索内容', { exact: true }).fill('模型浏览器样例');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '模型浏览器样例', exact: true }) }).click();
  await page.getByLabel('评分', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('外部网址', { exact: true }).count(), 0);
  await page.getByLabel('评分', { exact: true }).fill('20');
  const before = (await api('entry/cms-project-a')).revision;
  await page.getByRole('button', { name: '检查', exact: true }).click();
  await page.locator('.content-check [data-error-path="fields.rating"]').waitFor();
  assert.equal((await api('entry/cms-project-a')).revision, before);
  await page.getByLabel('评分', { exact: true }).fill('7');
  await page.getByLabel('外部项目', { exact: true }).check();
  await page.getByLabel('外部网址', { exact: true }).fill('https://example.com/project');
  await page.locator('[data-field-path="fields.client"]').getByRole('button', { name: '选择内容', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择内容', exact: true });
  await picker.getByRole('button', { name: /cms-client-a/ }).waitFor();
  assert.equal(await picker.getByRole('button', { name: /cms-client-b/ }).count(), 0);
  await picker.getByRole('button', { name: /cms-client-a/ }).click();
  const team = page.getByRole('group', { name: '团队', exact: true });
  await team.getByRole('button', { name: '下移第1项', exact: true }).click();
  await team.getByRole('button', { name: '展开第1项', exact: true }).click();
  await team.getByLabel('姓名', { exact: true }).first().fill('乙改');
  let saved: any;
  for (let i = 0; i < 60; i++) { saved = await api('entry/cms-project-a'); if (saved.value.fields.team[0].name === '乙改' && saved.value.fields.client === 'cms-client-a') break; await new Promise((resolve) => setTimeout(resolve, 150)); }
  assert.deepEqual(saved.value.fields.team, [{ name: '乙改' }, { name: '甲' }]);
  assert.equal(saved.value.fields.rating, 7); assert.equal(saved.value.fields.client, 'cms-client-a');
  await page.getByRole('button', { name: '检查', exact: true }).click(); await page.getByText('检查通过，尚未发布。', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'cms-model-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '内容类型', exact: true }).click();
  await page.locator('.object-list').getByRole('button', { name: /项目资料/ }).click();
  await page.locator('.type-admin-layout > summary').click();
  const row = page.locator('.type-field-row').filter({ has: page.getByText('评分', { exact: true }) });
  await row.getByLabel('宽度', { exact: true }).selectOption('full');
  await page.getByRole('button', { name: '保存类型', exact: true }).click();
  for (let i = 0; i < 30; i++) { const types = await api('types'); if (types.find((row: any) => row.id === 'cms-project').value.admin.fields[0].width === 'full') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('types')).find((row: any) => row.id === 'cms-project').value.admin.fields[0].width, 'full');
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await page.getByLabel('筛选内容类型').selectOption('cms-project');
  await page.getByText('评分：7', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, 'cms-model-list-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { defaults: true, conditionalFields: true, referencePicker: true, unsavedPreflight: true, cliCheck: true, repeatOrderingAndEditing: true, typeLayoutPersisted: true, customListColumn: true, mobile: true };
}
