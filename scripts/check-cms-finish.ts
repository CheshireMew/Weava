import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { Engagement, Site } from '@weava/core';

export function seedCmsFinish(root: string) {
  const folder = join(root, 'extensions'), path = join(folder, 'manifest.json');
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, extensions: [] };
  manifest.extensions.push({ id: 'inputs', file: 'inputs.mjs' }); writeFileSync(path, JSON.stringify(manifest));
  const source = `export default()=>({id:'inputs',label:'专用字段',apiVersion:1,fieldWidgets:{'inputs:color':{label:'颜色',type:'text',control:'color'},'inputs:rating':{label:'评分',type:'number',control:'range',min:1,max:5}},panels:[{id:'inputs:newsletter',label:'通讯专属设置',themes:['newsletter'],fields:[{key:'signature',label:'通讯署名',type:'text'}]}]});`;
  writeFileSync(join(folder, 'inputs.ts'), source); writeFileSync(join(folder, 'inputs.mjs'), source);
}
export async function checkCmsFinish({ origin, api, cli, page, context, output, root }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; cli: (args: string[]) => Promise<any>;
  page: Page; context: BrowserContext; output: string; root: string;
}) {
  const evidence: Record<string, boolean> = new Proxy({}, { set(target, key, value) { console.log('CMS check passed: ' + String(key)); return Reflect.set(target, key, value); } });
  const job = async (value: any) => { for (let i = 0; i < 300 && ['queued','running'].includes(value.status); i++) { await new Promise((resolve) => setTimeout(resolve, 100)); value = await api('job/' + value.id); } assert.equal(value.status, 'complete', JSON.stringify(value)); return value.result; };
  const publish = async (value: any) => { const checked = await api('publication', value); return job(await api('publish', checked.options)); };
  const open = async (title: string) => { await page.goto(origin + '/admin/'); await page.getByLabel('搜索内容').fill(title); await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click(); await page.getByLabel('内容标题').waitFor(); };
  const saved = async (id: string, predicate: (row: any) => boolean) => { let row; for (let i = 0; i < 100; i++) { row = await api('entry/' + id); if (predicate(row)) return row; await new Promise((resolve) => setTimeout(resolve, 100)); } assert.fail('editor did not persist ' + id); };
  const initialSettings = await api('settings'); if (initialSettings.value.theme !== 'weava') { await api('settings', { value: { ...initialSettings.value, theme: 'weava', themeConfig: initialSettings.value.themeSettings?.weava ?? initialSettings.value.themeConfig }, revision: initialSettings.revision }); await publish({ scope: 'settings' }); }
  await api('types', { value: { id: 'cms-finish', label: '专项内容', pathPrefix: '/cms/', template: 'article', fields: [{ key: 'color', label: '专用颜色', type: 'text', widget: 'inputs:color', defaultValue: '#123456' }, { key: 'rating', label: '专用评分', type: 'number', widget: 'inputs:rating', defaultValue: 3 }] }, revision: null });
  const source = '摘要段落。\n\n<!-- more -->\n\n后半段正文。\n\n```ts linenos {2}\nconst count = 1;\nconsole.log(count);\n```';
  const a = await api('entry', { value: { id: 'cms-a', kind: 'content', type: 'cms-finish', title: '专项甲文章', path: '/cms/a/', summaryMode: 'marker', categories: ['专项分类'], tags: ['专项主题'], document: { version: 1, format: 'markdown', source }, documentation: { group: '专项文档', order: 1 } }, revision: null });
  const b = await api('entry', { value: { id: 'cms-b', kind: 'content', type: 'cms-finish', title: '专项乙文章', path: '/cms/b/', tags: ['专项主题'], documentation: { group: '专项文档', order: 2, parentId: a.id }, document: { version: 1, format: 'markdown', source: '乙正文' } }, revision: null });
  await publish({ ids: [a.id, b.id] });
  // The selection must survive saving the current editor before bulk edit opens.
  await open(a.value.title); await page.getByLabel('专用颜色', { exact: true }).fill('#445566'); await page.getByLabel('专用评分', { exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await saved(a.id, (row) => row.value.fields.color === '#445566' && row.value.fields.rating === 4);
  await page.getByLabel('搜索内容').fill('专项'); await page.getByLabel('批量选择 专项甲文章').check(); await page.getByLabel('批量选择 专项乙文章').check();
  await page.getByRole('button', { name: '批量编辑（2）', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '批量编辑', exact: true }); await dialog.getByLabel('作者', { exact: true }).fill('批量作者');
  await dialog.getByRole('button', { name: '检查修改', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal((await api('entry/' + b.id)).value.author, '批量作者'); assert(!(await fetch(origin + '/cms/b/').then((r) => r.text())).includes('批量作者'));
  evidence.bulkPreviewAndDraftIsolation = true;
  await open(a.value.title); await page.getByRole('button', { name: '使用区块正文', exact: true }).click(); await page.getByLabel('区块类型').waitFor();
  const structured = await saved(a.id, (row) => row.value.blocks.length > 0); assert(structured.value.blocks[0].props.text.includes('摘要段落'));
  page.once('dialog', (prompt) => prompt.accept('专项正文片段')); await page.getByRole('button', { name: '保存正文片段', exact: true }).click();
  const pattern = (await api('layouts')).find((row: any) => row.value.label === '专项正文片段'); assert(pattern);
  await page.getByLabel('插入组合').selectOption(pattern.id); let inserted = await saved(a.id, (row) => row.value.blocks.length === 2);
  assert.notEqual(inserted.value.blocks[0].id, inserted.value.blocks[1].id);
  inserted = await api('entry', { value: { ...inserted.value, blocks: inserted.value.blocks.map((block: any, index: number) => index ? block : { ...block, props: { ...block.props, text: block.props.text.replace('摘要段落。', '区块改稿摘要。') } }) }, revision: inserted.revision });
  await open(a.value.title);
  await page.locator('.editorial-fields summary').click(); await page.getByLabel('首页推荐', { exact: true }).check(); await page.getByLabel('推荐顺序权重').fill('80');
  await page.getByRole('button', { name: '选择推荐内容', exact: true }).click(); dialog = page.getByRole('dialog', { name: '选择内容', exact: true }); await dialog.getByLabel('查找内容').fill(b.value.title); await dialog.locator('.selector-item').filter({ hasText: b.value.title }).click();
  await saved(a.id, (row) => row.value.editorial?.featured && row.value.editorial.relatedIds.includes(b.id));
  await publish({ ids: [a.id, b.id] }); evidence.structuredBodyAndIndependentSnippet = true; evidence.widgetEditorAndValidation = true;
  const visitor = await context.newPage(); await visitor.goto(origin + '/cms/b/');
  await visitor.getByRole('navigation', { name: '面包屑', exact: true }).getByRole('link', { name: a.value.title, exact: true }).waitFor();
  await visitor.getByRole('navigation', { name: '文档翻页', exact: true }).getByRole('link', { name: a.value.title, exact: true }).waitFor();
  await visitor.goto(origin + '/cms/a/'); await visitor.getByRole('navigation', { name: '文档翻页', exact: true }).getByRole('link', { name: b.value.title, exact: true }).waitFor();
  const sidebar = await visitor.locator('.doc-navigation').boundingBox(), body = await visitor.locator('.doc-content').boundingBox(); assert(sidebar && body && sidebar.x + sidebar.width <= body.x, 'desktop documents need a side navigation');
  await visitor.locator('.related-content').getByRole('link', { name: b.value.title, exact: true }).waitFor(); evidence.documentationAndRelated = true;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  assert.equal(decodeURIComponent((await visitor.locator('[data-code-source]').first().getAttribute('data-code-source'))!), 'const count = 1;\nconsole.log(count);\n');
  await visitor.locator('[data-copy-code]').first().click(); assert.equal((await visitor.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), 'const count = 1;\nconsole.log(count);\n');
  assert(await visitor.locator('.code-block [data-line="2"]').count() > 0); evidence.syntaxLinesAndExactCopy = true;
  const publicEntries = await fetch(origin + '/api/v1/content?type=cms-finish&limit=100').then((r) => r.json()) as any[];
  assert.equal(publicEntries.find((entry) => entry.id === a.id).description, '区块改稿摘要。');
  assert.equal(await visitor.locator('meta[name="description"]').getAttribute('content'), '区块改稿摘要。');
  const feed = await fetch(origin + '/rss.xml?type=cms-finish').then((r) => r.text()); assert(feed.includes('专项甲文章') && feed.includes('专项乙文章') && !feed.includes('Article 0'));
  const categoryId = (await api('terms')).find((row: any) => row.value.label === '专项分类').id;
  const categoryFeed = await fetch(origin + '/rss.xml?category=' + categoryId).then((r) => r.text()); assert(categoryFeed.includes('专项甲文章') && !categoryFeed.includes('专项乙文章'));
  assert(await visitor.locator('head link[rel="alternate"][href*="type=cms-finish"]').count() > 0); evidence.summaryAndScopedFeeds = true;
  // Theme changes restore the previous values, and theme-owned panels follow the selected theme.
  await page.getByRole('button', { name: '外观与导航', exact: true }).click(); const originalTheme = await page.getByLabel('主题', { exact: true }).inputValue();
  await page.getByLabel('强调色', { exact: true }).fill('#123abc'); await page.getByLabel('主题', { exact: true }).selectOption('newsletter');
  await page.getByRole('heading', { name: '通讯专属设置', exact: true }).waitFor(); await page.getByLabel('强调色', { exact: true }).fill('#ab123c');
  await page.getByLabel('主题', { exact: true }).selectOption(originalTheme); assert.equal(await page.getByLabel('强调色', { exact: true }).inputValue(), '#123abc');
  assert.equal(await page.getByLabel('通讯署名', { exact: true }).count(), 0); await page.getByLabel('主题', { exact: true }).selectOption('newsletter'); assert.equal(await page.getByLabel('强调色', { exact: true }).inputValue(), '#ab123c');
  await page.getByRole('button', { name: '发布设置', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor(); await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 }); evidence.themeSettingsRestored = true;
  const home = await api('entry/home'); await api('entry', { value: { ...home.value, template: 'newsletter-home' }, revision: home.revision }); await publish({ ids: [home.id] });
  await visitor.goto(origin + '/'); assert.equal(await visitor.locator('.nl-feature').getByRole('link').first().getAttribute('href'), '/cms/a/');
  await visitor.goto(origin + '/cms/a/'); await visitor.getByLabel('评论内容', { exact: true }).waitFor();
  const fixture = new Site(root), engagement = new Engagement(fixture.store.raw, fixture.cliToken(), { code: () => 'A2BCD' });
  await visitor.route('**/api/v1/comment-captcha', async (route) => { const token = (await context.cookies(origin)).find((cookie) => cookie.name === 'weava-reader')!.value; await route.fulfill({ json: await engagement.createCaptcha(token, '127.0.0.1') }); });
  try {
    await visitor.getByLabel('评论内容', { exact: true }).fill('专项待审核评论'); await visitor.getByLabel('称呼', { exact: true }).fill('专项读者'); await visitor.getByLabel('验证码', { exact: true }).fill('A2BCD'); await visitor.getByRole('button', { name: '发布评论', exact: true }).click();
    await visitor.getByText('评论已提交，等待审核', { exact: true }).waitFor(); assert.equal(await visitor.locator('[data-comment-list]').getByText('专项待审核评论', { exact: true }).count(), 0);
  } finally { fixture.close(); }
  await page.getByRole('button', { name: '评论', exact: true }).click(); await page.getByLabel('评论状态', { exact: true }).selectOption('pending');
  await page.locator('.admin-comment').filter({ hasText: '专项待审核评论' }).getByRole('button', { name: '通过审核', exact: true }).click();
  await page.locator('.admin-comment').filter({ hasText: '专项待审核评论' }).waitFor({ state: 'hidden' });
  await visitor.reload(); await visitor.locator('[data-comment-list]').getByText('专项待审核评论', { exact: true }).waitFor();
  await open(a.value.title); await page.getByLabel('允许新评论', { exact: true }).uncheck(); await saved(a.id, (row) => row.value.allowComments === false); await publish({ ids: [a.id] });
  await visitor.reload(); assert.equal(await visitor.getByLabel('评论内容', { exact: true }).isVisible(), false); await visitor.locator('[data-comment-list]').getByText('专项待审核评论', { exact: true }).waitFor(); await visitor.getByRole('button', { name: '点赞', exact: true }).first().click(); await visitor.waitForFunction(() => document.querySelector('[data-article-action="like"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal((await (await context.request.get(origin + '/api/v1/engagement?id=' + a.id)).json()).likes, 1); evidence.moderatedCommentsAndPerEntryClosure = true;
  // Route publication has its own review and does not publish unrelated article drafts.
  await page.getByRole('button', { name: '网址别名', exact: true }).click(); await page.getByLabel('来源路径').fill('/cms-old/'); await page.getByLabel('目标路径').fill('/cms/a/');
  await page.getByRole('button', { name: '检查别名', exact: true }).click(); await page.getByRole('button', { name: '保存别名', exact: true }).click(); await page.locator('.object-list').getByRole('button', { name: /\/cms-old\// }).waitFor();
  await page.getByRole('button', { name: '发布别名', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor(); await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('heading', { name: '发布变更', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
  const redirected = await fetch(origin + '/cms-old/', { redirect: 'manual' }); assert.equal(redirected.status, 301); assert.equal(redirected.headers.get('location'), '/cms/a/'); evidence.aliasReviewAndPublication = true;
  const planned = await api('entries/create', { kind: 'content', type: 'post', title: '计划固定版本' });
  const retiring = await api('entries/create', { kind: 'content', type: 'post', title: '计划撤下内容' }); await publish({ ids: [retiring.id] });
  await page.getByRole('button', { name: '发布计划', exact: true }).click(); await page.getByLabel('计划名称').fill('专项上线计划');
  for (const title of [planned.value.title, retiring.value.title]) { await page.getByRole('button', { name: '添加内容', exact: true }).click(); dialog = page.getByRole('dialog', { name: '选择内容', exact: true }); await dialog.getByLabel('查找内容').fill(title); await dialog.locator('.selector-item').filter({ hasText: title }).click(); }
  await page.getByLabel('计划操作 2').selectOption('withdraw'); await page.getByRole('button', { name: '保存计划', exact: true }).click(); await page.locator('.object-list').getByRole('button', { name: /专项上线计划/ }).waitFor();
  assert(await page.locator('.plan-action').first().textContent().then((text) => text?.includes('计划固定版本')));
  await api('entry', { value: { ...planned.value, title: '计划之后的新改稿' }, revision: planned.revision });
  await page.getByRole('button', { name: '检查计划', exact: true }).click(); await page.getByRole('button', { name: '确认执行', exact: true }).click(); await page.locator('.object-list').getByText('已完成', { exact: true }).waitFor({ timeout: 30000 });
  assert((await fetch(origin + planned.value.path).then((r) => r.text())).includes('计划固定版本')); assert.equal((await fetch(origin + retiring.value.path)).status, 404); assert.equal((await api('entry/' + planned.id)).value.title, '计划之后的新改稿'); evidence.namedFrozenPublicationPlan = true;
  // Image specifications are editable through the media manager and reused by the shared picker and CLI.
  const uploaded = await job(await api('media', { name: '专项图片.png', base64: (await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ff5533' } }).png().toBuffer()).toString('base64') }));
  const original = await fetch(origin + uploaded.value.url).then((r) => r.arrayBuffer());
  await page.getByRole('button', { name: '媒体', exact: true }).click(); await page.getByRole('button', { name: '专项图片.png', exact: true }).click(); await page.getByLabel('焦点横向 %').fill('90');
  await page.getByText('图片规格', { exact: true }).click(); await page.getByLabel('输出宽度').fill('100'); await page.getByLabel('输出高度').fill('100'); await page.getByLabel('规格名称').fill('专项方图'); await page.getByRole('button', { name: '保存规格', exact: true }).click();
  await page.getByRole('button', { name: '归档规格', exact: true }).waitFor(); await page.getByRole('button', { name: '生成图片规格', exact: true }).click(); await page.getByRole('link', { name: '100 × 100 · webp', exact: true }).waitFor();
  const first = (await api('media/variants?id=' + uploaded.id))[0], preset = (await api('media/presets')).find((row: any) => row.value.label === '专项方图');
  const input = join(output, 'image-variant-input.json'); writeFileSync(input, JSON.stringify({ id: uploaded.id, revision: (await api('media')).find((row: any) => row.id === uploaded.id).revision, presetId: preset.id }));
  await cli(['media', 'variant', '--input', input, '--wait']); assert.equal((await api('media/variants?id=' + uploaded.id)).length, 1); assert.equal((await api('media/variants?id=' + uploaded.id))[0].id, first.id);
  const afterImage: ArrayBuffer = await (await fetch(origin + uploaded.value.url)).arrayBuffer();
  assert.deepEqual(new Uint8Array(afterImage), new Uint8Array(original));
  await page.getByRole('button', { name: '上传或选择媒体', exact: true }).click(); dialog = page.getByRole('dialog', { name: '选择媒体', exact: true }); await dialog.getByLabel('图片使用规格').selectOption(preset.id); await dialog.getByLabel('搜索媒体').fill('专项图片'); await dialog.getByRole('button', { name: '专项图片.png', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); evidence.imagePresetsFocalPointAndReuse = true;
  await open(a.value.title); await page.getByRole('button', { name: '选择封面', exact: true }).click(); dialog = page.getByRole('dialog', { name: '选择媒体', exact: true }); await dialog.getByLabel('图片使用规格').selectOption(preset.id); await dialog.getByLabel('搜索媒体').fill('专项图片'); await dialog.getByRole('button', { name: '专项图片.png', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await saved(a.id, (row) => row.value.cover === first.value.url); evidence.imagePresetSelectedIntoContent = true;
  const schema = await cli(['schema', '--format', 'json']); assert(schema.types.some((type: any) => type.id === 'cms-finish' && type.schema.properties.fields.properties.color.pattern));
  assert.equal((await cli(['schema', '--format', 'openapi'])).openapi, '3.1.0'); const typesFile = join(output, 'site-types.ts'); await cli(['schema', '--format', 'types', '--output', typesFile]); assert(readFileSync(typesFile, 'utf8').includes('"cms-finish"')); evidence.schemaAndCliExports = true;
  await page.screenshot({ path: join(output, 'cms-finish-images.png'), fullPage: true }); await visitor.screenshot({ path: join(output, 'cms-finish-article.png'), fullPage: true });
  await visitor.setViewportSize({ width: 390, height: 844 }); assert(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await visitor.screenshot({ path: join(output, 'cms-finish-article-mobile.png'), fullPage: true }); evidence.documentMobileLayout = true;
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '打开菜单', exact: true }).click(); await page.getByRole('button', { name: '发布计划', exact: true }).click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: join(output, 'cms-finish-mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 });
  await visitor.close(); return evidence;
}
