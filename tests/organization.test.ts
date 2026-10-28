import { afterEach, describe, expect, it } from 'vitest';
import { Site, queryPublished, queryDrafts, renderBlocks, contentQuery, saveLayout } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/organization-' + Date.now(), sites: Site[] = []; let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); site.saveType({ id: 'resource', label: '资源', template: 'resource', pathPrefix: '/resources/', fields: [{ key: 'platform', label: '平台', type: 'select', options: ['Windows', 'Linux'], filterable: true }, { key: 'year', label: '年份', type: 'number', filterable: true }, { key: 'free', label: '免费', type: 'boolean', filterable: true }, { key: 'internal', label: '内部信息', type: 'text' }] }, null); return site; };
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('declared content filters and taxonomy organization', () => {
  it('uses the same declared, typed filters in public queries, drafts, blocks and URL forms', () => {
    const site = create();
    for (let i = 0; i < 4; i++) site.saveEntry(entrySchema.parse({ id: 'resource-' + i, type: 'resource', kind: 'content', title: '资源 ' + i, path: '/resources/' + i + '/', status: 'published', fields: { platform: i < 3 ? 'Windows' : 'Linux', year: 2026, free: i < 2 } }), null);
    const release = site.publish(), query = contentQuery(new URLSearchParams('type=resource&field.platform=Windows&field.free=true&pageSize=1&page=2'));
    expect(queryPublished(site, query)).toMatchObject({ total: 2, pages: 2, items: [{ id: 'resource-1' }] });
    expect(queryDrafts(site, query)).toMatchObject({ total: 2, pages: 2, items: [{ id: 'resource-1' }] });
    expect(() => queryPublished(site, { fields: { platform: 'Windows' } })).toThrow(/内容类型/);
    expect(() => queryPublished(site, { type: 'resource', fields: { internal: 'hidden' } })).toThrow(/未声明/);
    expect(() => queryPublished(site, { type: 'resource', fields: { year: 'invalid' } })).toThrow(/筛选值无效/);
    expect(() => queryPublished(site, { type: 'resource', fields: { platform: 'unknown' } })).toThrow(/筛选值无效/);
    const html = renderBlocks([{ id: 'list', type: 'content-list', props: { contentType: 'resource', filters: 'show', limit: 1 } }], release, undefined, {}, { url: new URL('https://site.example/catalog/?field.platform=Windows&field.free=true&page=2') });
    expect(html).toContain('name="field.platform"'); expect(html).not.toContain('name="field.internal"'); expect(html).toContain('资源 1'); expect(html).not.toContain('资源 0</h'); expect(html).toContain('field.platform=Windows');
    expect(contentQuery(new URLSearchParams('type=resource&field.platform=&field.free=')).fields).toEqual({});
  });
  it('keeps exact stable associations for equally named children and publishes taxonomy edits independently', () => {
    const site = create(); site.saveTerm({ id: 'design', kind: 'category', label: '设计', slug: 'design' }, null); site.saveTerm({ id: 'code', kind: 'category', label: '开发', slug: 'code' }, null);
    site.saveTerm({ id: 'design-guide', kind: 'category', label: '教程', slug: 'design-guide', parentId: 'design' }, null); site.saveTerm({ id: 'code-guide', kind: 'category', label: '教程', slug: 'code-guide', parentId: 'code' }, null);
    const entry = site.saveEntry(entrySchema.parse({ id: 'entry', kind: 'content', type: 'resource', title: '公开资源', path: '/resource/', status: 'published', categories: ['教程'], termIds: { categories: ['code-guide'], tags: [] } }), null);
    const release = site.publish(); expect(release.entries[0].termIds!.categories).toEqual(['code-guide']);
    site.saveEntry({ ...entry.value, title: '未发布标题' }, entry.revision); const settings = site.settings(); site.saveSettings({ ...settings.value, name: '未发布站名' }, settings.revision);
    const layout = saveLayout(site, { id: 'unused-region', kind: 'region', appliesTo: 'any', label: '未发布区域', blocks: [] }, null);
    const term = site.store.get('term', 'code-guide')!; site.saveTerm({ ...term.value, label: '开发教程', parentId: 'design' }, term.revision);
    const preview = site.previewPublication({ scope: 'terms' }); expect(preview.termsChanged).toBe(true); expect(preview.settingsChanged).toBe(false);
    const next = site.publish(preview.options); expect(next.entries[0].title).toBe('公开资源'); expect(next.settings.name).toBe(release.settings.name); expect(next.layouts!.some((item) => item.id === layout.id)).toBe(false);
    expect(next.entries[0].categories).toEqual(['开发教程']); expect(queryPublished(site, { category: 'code-guide' }).total).toBe(1); expect(queryPublished(site, { category: 'design-guide' }).total).toBe(0);
    expect(queryPublished(site, { category: 'design' }).total).toBe(1);
    const directory = renderBlocks([{ id: 'taxonomy', type: 'taxonomy', props: {} }], next); expect(directory).toContain('开发教程'); expect(directory).toContain('category=design');
    site.rollback(release.id); expect(site.release()!.entries[0].categories).toEqual(['教程']);
    expect(() => site.saveTerm({ id: 'design', kind: 'category', label: '设计', slug: 'design', parentId: 'code-guide' }, site.store.get('term','design')!.revision)).toThrow(/循环/);
  });
});
