import type { BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { entrySchema } from '@weava/contracts';

export async function checkAuthoring({ origin, api, page, context, output }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; page: Page; context: BrowserContext; output: string;
}) {
  const evidence: Record<string, any> = {};
  const region = await api('layouts', { value: { id: 'studio-note', label: '联系区域', kind: 'region', appliesTo: 'any', blocks: [{ id: 'note', type: 'text', props: { text: '共享联系区域独有文字' } }] }, revision: null });
  await api('layouts', { value: { id: 'studio-template', label: '工作室模板', kind: 'template', appliesTo: 'page', blocks: [
    { id: 'shared', type: 'shared', props: { layoutId: region.id } }, { id: 'body', type: 'entry-body', props: {} },
  ] }, revision: null });
  const value = entrySchema.parse({ id: 'studio', kind: 'page', title: '官网页面专项', path: '/studio/', template: 'studio-template', blocks: [
    { id: 'hero', type: 'hero', props: { title: '原主视觉标题', description: '官网介绍内容' } },
    { id: 'columns', type: 'columns', props: { columns: 2 }, children: [{ id: 'service-a', type: 'text', props: { text: '## 服务一\n\n内容一' } }, { id: 'service-b', type: 'text', props: { text: '## 服务二\n\n内容二' } }] },
  ] });
  await api('entry', { value, revision: null });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(origin + '/admin/');
  await page.getByRole('button', { name: '页面', exact: true }).click();
  await page.getByLabel('搜索内容').fill('官网页面专项');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '官网页面专项', exact: true }) }).click();
  const frame = page.frameLocator('iframe[title="页面画布"]');
  await frame.getByRole('heading', { name: '原主视觉标题', exact: true }).waitFor();
  await frame.getByRole('heading', { name: '原主视觉标题', exact: true }).dblclick();
  const editable = frame.locator('[contenteditable]'); await editable.fill('画布内直接编辑的标题');
  await page.getByRole('button', { name: '手机', exact: true }).click();
  await frame.getByRole('heading', { name: '画布内直接编辑的标题', exact: true }).waitFor();
  await page.waitForFunction(() => (document.querySelector('iframe[title="页面画布"]') as HTMLIFrameElement)?.contentWindow?.innerWidth === 390);
  await page.screenshot({ path: join(output, 'canvas-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '展开画布', exact: true }).click();
  await page.getByRole('button', { name: '桌面', exact: true }).click();
  await page.locator('.designer-outline').getByRole('button', { name: '多列', exact: true }).click();
  await page.locator('.designer-inspector').getByText('布局', { exact: true }).click();
  await page.getByLabel('桌面列数').fill('3');
  await page.getByLabel('手机列数').fill('1');
  await page.locator('.designer-outline').getByLabel('区块类型').selectOption('image');
  await page.locator('.designer-outline').getByRole('button', { name: '添加区块', exact: true }).click();
  await page.locator('.designer-inspector').getByRole('button', { name: '选择媒体', exact: true }).click();
  const image = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#547b65' } }).png().toBuffer();
  const imageFile = join(output, 'studio-image.png'); writeFileSync(imageFile, image);
  await page.locator('dialog input[type=file]').setInputFiles(imageFile);
  await page.locator('dialog').getByRole('button', { name: 'studio-image.png', exact: true }).waitFor({ timeout: 30000 });
  await page.locator('dialog').getByRole('button', { name: 'studio-image.png', exact: true }).click();
  await page.screenshot({ path: join(output, 'canvas-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '收起画布', exact: true }).click();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const publicPage = await context.newPage(); await publicPage.goto(origin + '/studio/');
  await publicPage.getByRole('heading', { name: '画布内直接编辑的标题', exact: true }).waitFor();
  assert((await publicPage.locator('main').innerText()).includes('共享联系区域独有文字'));
  assert.equal(await publicPage.locator('main img').count(), 1);
  evidence.canvas = { inlineEditPublished: true, mediaUploadAndSelection: true, widths: [390, 1100], sharedRegion: true };
  const saved = await api('entry/studio');
  const columns = saved.value.blocks.find((block: any) => block.id === 'columns');
  assert.equal(columns.style.columns.desktop, 3); assert.equal(columns.style.columns.mobile, 1);
  assert.equal(columns.children.length, 3);
  await page.getByRole('button', { name: '布局', exact: true }).click();
  await page.getByRole('button', { name: '工作室模板', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('工作室模板已编辑');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await page.getByRole('button', { name: '发布布局', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  evidence.layoutEditor = true;
  await page.getByLabel('名称', { exact: true }).fill('离开布局页也能保留修改');
  await page.getByRole('button', { name: '外观与导航', exact: true }).click();
  assert.equal((await api('layouts')).find((row: any) => row.id === 'studio-template').value.label, '离开布局页也能保留修改');
  evidence.layoutNavigationSavesDraft = true;
  await page.getByRole('heading', { name: '外观与导航', exact: true }).waitFor();
  await page.getByRole('combobox').filter({ has: page.locator('option[value="newsletter"]') }).selectOption('newsletter');
  await page.getByRole('button', { name: '发布设置', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  await publicPage.reload();
  await publicPage.getByRole('heading', { name: '画布内直接编辑的标题', exact: true }).waitFor();
  assert((await publicPage.locator('main').innerText()).includes('共享联系区域独有文字')); assert.equal(await publicPage.locator('main img').count(), 1);
  await publicPage.screenshot({ path: join(output, 'page-after-theme-change.png'), fullPage: true });
  evidence.themeChangePreservesPage = true;
  await publicPage.close();
  return evidence;
}
