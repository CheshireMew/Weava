import { afterEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Site, extension, siteSchema, exportSite, importSite } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const sites: Site[] = [], managers: any[] = [], root = 'D:/Tools/cache/weava/tests/field-widgets-' + Date.now(); let sequence = 0;
async function create() {
  const site = new Site(root + '/' + sequence++); sites.push(site);
  mkdirSync(join(site.root, 'extensions'), { recursive: true });
  writeFileSync(join(site.root, 'extensions', 'index.mjs'), `export default ()=>({id:'inputs',apiVersion:1,fieldWidgets:{'inputs:color':{label:'颜色',type:'text',control:'color'},'inputs:rating':{label:'评分滑块',type:'number',control:'range',min:0,max:10}}})`);
  const manager = await extension(site); managers.push(manager); return { site, manager };
}
afterEach(async () => { for (const manager of managers.splice(0)) await manager.stop(); for (const site of sites.splice(0)) site.close(); });
it('registers typed widgets and shares validation, schema generation and exchange without changing stored primitives', async () => {
  const { site, manager } = await create();
  expect(manager.status()[0].status).toBe('active');
  site.saveType({ id: 'project', label: '项目', pathPrefix: '/p/', template: 'article', fields: [{ key: 'color', label: '颜色', type: 'text', widget: 'inputs:color' }, { key: 'rating', label: '评分', type: 'number', widget: 'inputs:rating' }] }, null);
  const value = entrySchema.parse({ id: 'a', kind: 'content', type: 'project', title: 'a', path: '/a/', fields: { color: '#12ab34', rating: 7 } });
  site.saveEntry(value, null);
  expect(() => site.saveEntry({ ...value, id: 'bad', path: '/bad/', fields: { color: 'red', rating: 100 } }, null)).toThrow(/颜色|评分/);
  const dynamic = siteSchema(site).types[0].schema as any; expect(dynamic.properties.fields.properties.color.pattern).toBe('^#[a-fA-F0-9]{6}$');
  const { site: target } = await create(); importSite(target, exportSite(site)); expect(target.store.get('entry','a')!.value.fields).toEqual({ color: '#12ab34', rating: 7 });
  await expect(manager.setEnabled('inputs', false, null)).rejects.toThrow(/使用/);
});
it('refuses a widget with the wrong backing type and reports missing registered widgets', async () => {
  const { site } = await create();
  expect(() => site.saveType({ id: 'bad', label: '错误', pathPrefix: '/b/', template: 'article', fields: [{ key: 'color', label: '颜色', type: 'number', widget: 'inputs:color' }] }, null)).toThrow(/基础类型/);
  expect(() => site.saveType({ id: 'missing', label: '缺少', pathPrefix: '/b/', template: 'article', fields: [{ key: 'color', label: '颜色', type: 'text', widget: 'missing:color' }] }, null)).toThrow(/不可用/);
});
it('combines field and widget patterns rather than replacing either rule', async () => {
  const { site } = await create();
  site.saveType({ id: 'color', label: '品牌色', pathPrefix: '/c/', template: 'article', fields: [{ key: 'brand', label: '品牌色', type: 'text', widget: 'inputs:color', pattern: '^#12', defaultValue: '#123456' }] }, null);
  const value = entrySchema.parse({ id: 'color', kind: 'content', type: 'color', title: '颜色', path: '/color/', fields: { brand: '#123456' } }); site.saveEntry(value, null);
  for (const brand of ['#ff3456', '#12oops']) expect(() => site.saveEntry({ ...value, id: brand, path: '/invalid/', fields: { brand } }, null)).toThrow(/格式/);
  const dynamic = JSON.stringify(siteSchema(site).types[0].schema); expect(dynamic).toContain('^#12'); expect(dynamic).toContain('^#[a-fA-F0-9]{6}$');
});
