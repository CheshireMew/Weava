import { afterEach, describe, expect, it } from 'vitest';
import { Site, layouts, saveLayout, renderEntryTemplate, renderSharedRegion, exportSite, importSite, copyPattern } from '@weava/core';
import { entrySchema, type Layout } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/layouts-' + Date.now();
const sites: Site[] = []; let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null); return site; };
const page = (id: string, extra = {}) => entrySchema.parse({ id, kind: 'page', title: '页面 ' + id, path: '/' + id + '/', status: 'published', blocks: [{ id: 'text', type: 'text', props: { text: '原页面独有内容' } }], ...extra });
const region = (id: string, text: string): Layout => ({ id, kind: 'region', label: id, appliesTo: 'any', blocks: [{ id: 'text', type: 'text', props: { text } }] });
const template = (id: string): Layout => ({ id, kind: 'template', label: id, appliesTo: 'any', blocks: [{ id: 'heading', type: 'hero', props: { title: '模板标题' } }, { id: 'body', type: 'entry-body', props: {} }] });
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('templates and shared regions', () => {
  it('uses type defaults and entry overrides, preserving the body when the published theme changes', () => {
    const site = create(); const type = site.store.get('type', 'post')!;
    site.saveType({ ...type.value, template: 'portfolio' }, type.revision);
    site.saveEntry(page('article', { kind: 'content', document: { version: 1, format: 'markdown', source: '文章正文' }, blocks: [] }), null);
    let release = site.publish();
    expect(renderEntryTemplate(release.entries[0], release)).toContain('data-template="portfolio"');
    const entry = site.store.get('entry', 'article')!;
    site.saveEntry({ ...entry.value, template: 'resource' }, entry.revision); release = site.publish({ ids: ['article'] });
    expect(renderEntryTemplate(release.entries[0], release)).toContain('data-template="resource"');
    const settings = site.settings(); site.saveSettings({ ...settings.value, theme: 'newsletter' }, settings.revision); release = site.publish({ scope: 'settings' });
    expect(renderEntryTemplate(release.entries[0], release)).toContain('文章正文');
    expect(renderEntryTemplate(release.entries[0], release)).toContain('data-template="resource"');
  });
  it('publishes layouts independently from settings and content drafts, with rollback restoring layout objects', () => {
    const site = create(); const layout = saveLayout(site, template('custom'), null); const entry = site.saveEntry(page('one', { template: 'custom' }), null);
    const first = site.publish();
    saveLayout(site, { ...layout.value, blocks: [{ id: 'title', type: 'hero', props: { title: '布局新标题' } }, { id: 'body', type: 'entry-body', props: {} }] }, layout.revision);
    site.saveEntry({ ...entry.value, title: '未发布文章改稿' }, entry.revision);
    const settings = site.settings(); site.saveSettings({ ...settings.value, name: '未发布设置' }, settings.revision);
    const review = site.previewPublication({ scope: 'layouts' }); expect(review.layoutsChanged).toBe(true); expect(review.entries).toEqual([]); expect(review.settingsChanged).toBe(false);
    const next = site.publish(review.options); expect(next.settings.name).toBe(first.settings.name); expect(next.entries[0].title).toBe(first.entries[0].title);
    expect(renderEntryTemplate(next.entries[0], next)).toContain('布局新标题');
    site.rollback(first.id); expect(renderEntryTemplate(site.release()!.entries[0], site.release()!)).toContain('模板标题');
  });
  it('does not publish an edited shared region through an unrelated settings or entry publication', () => {
    const site = create(); const shared = saveLayout(site, region('shared-note', '旧共享文字'), null);
    site.saveEntry(page('one', { blocks: [{ id: 'shared', type: 'shared', props: { layoutId: shared.id } }] }), null);
    site.publish(); saveLayout(site, region(shared.id, '新共享文字'), shared.revision);
    const release = site.publish({ scope: 'settings' }); expect(renderEntryTemplate(release.entries[0], release)).toContain('旧共享文字');
    expect(renderEntryTemplate(release.entries[0], release)).not.toContain('新共享文字');
    const next = site.publish({ scope: 'layouts' }); expect(renderEntryTemplate(next.entries[0], next)).toContain('新共享文字');
  });
  it('renders configured header/footer regions from the same immutable release', () => {
    const site = create(); saveLayout(site, region('header', '共享页头'), null); saveLayout(site, region('footer', '共享页脚'), null);
    site.saveEntry(page('one'), null); const settings = site.settings(); site.saveSettings({ ...settings.value, regions: { header: 'header', footer: 'footer' } }, settings.revision);
    const release = site.publish(); expect(renderSharedRegion('header', release)).toContain('共享页头'); expect(renderSharedRegion('footer', release)).toContain('共享页脚');
  });
  it('validates body placement, shared region cycles, bindings, responsive values and template applicability before public commit', () => {
    const site = create(); site.saveEntry(page('one'), null); const first = site.publish();
    expect(() => saveLayout(site, { ...template('empty'), blocks: [] }, null)).toThrow(/只能有一个/);
    const a = saveLayout(site, region('a', 'A'), null); saveLayout(site, { ...region('b', 'B'), blocks: [{ id: 'shared', type: 'shared', props: { layoutId: 'a' } }] }, null);
    expect(() => saveLayout(site, { ...a.value, blocks: [{ id: 'shared', type: 'shared', props: { layoutId: 'b' } }] }, a.revision)).toThrow(/循环/);
    expect(() => site.saveEntry(page('recursive', { blocks: [{ id: 'body', type: 'entry-body', props: {} }] }), null)).toThrow(/自身/);
    expect(() => site.saveEntry(page('bad-style', { blocks: [{ id: 'text', type: 'text', props: {}, style: { padding: -10 } }] }), null)).toThrow();
    const row = site.store.get('entry', 'one')!; site.saveEntry({ ...row.value, template: 'article' }, row.revision);
    expect(() => site.publish()).toThrow(/不适用/); expect(site.release()!.id).toBe(first.id);
  });
  it('resolves bindings and editor markers without leaking template internals into the entry block selection', () => {
    const site = create();
    site.saveEntry(page('bound', { blocks: [{ id: 'hero', type: 'hero', props: {}, bindings: { title: { source: 'entry', key: 'title' }, description: { source: 'site', key: 'name' } }, style: { padding: 12, columns: { desktop: 3, tablet: 2, mobile: 1 } } }] }), null);
    const release = site.publish(); const html = renderEntryTemplate(release.entries[0], release, {}, { editable: true });
    expect(html).toContain('页面 bound'); expect(html).toContain('Weava'); expect(html).toContain('data-weava-block="hero"'); expect(html).not.toContain('data-weava-block="body"'); expect(html).toContain('--cols-mobile:1');
  });
  it('copies reusable patterns with independent identifiers and round trips stored layouts with their dependencies', () => {
    const source = create(); const pattern = layouts(source).find((row) => row.id === 'landing')!.value;
    const first = copyPattern(pattern), second = copyPattern(pattern); expect(first[0].id).not.toBe(second[0].id);
    saveLayout(source, region('shared', '可迁移区域'), null);
    saveLayout(source, { ...template('custom'), blocks: [{ id: 'shared', type: 'shared', props: { layoutId: 'shared' } }, { id: 'body', type: 'entry-body', props: {} }] }, null);
    source.saveEntry(page('page', { template: 'custom' }), null);
    const target = create(); importSite(target, exportSite(source)); const release = target.publish();
    expect(renderEntryTemplate(release.entries[0], release)).toContain('可迁移区域');
  });
  it('updates shared-region search without copying unchanged entries, and rolls search back with the release',()=>{
    const site=create(),shared=saveLayout(site,region('shared-search','共享旧搜索词'),null);site.saveEntry(page('one',{blocks:[{id:'shared',type:'shared',props:{layoutId:shared.id}}]}),null);const first=site.publish();
    expect(site.search('共享旧搜索词')).toHaveLength(1);const before=(site.store.raw.prepare("SELECT COUNT(*) n FROM publication_objects WHERE kind='entry'").get() as any).n;
    saveLayout(site,region(shared.id,'共享新搜索词'),shared.revision);site.publish({scope:'layouts'});expect(site.search('共享新搜索词')).toHaveLength(1);expect(site.search('共享旧搜索词')).toHaveLength(0);
    expect((site.store.raw.prepare("SELECT COUNT(*) n FROM publication_objects WHERE kind='entry'").get() as any).n).toBe(before);site.rollback(first.id);expect(site.search('共享旧搜索词')).toHaveLength(1);expect(site.search('共享新搜索词')).toHaveLength(0);
  });
  it('renders document navigation to stable heading anchors from the same body',()=>{
    const site=create();const type=site.store.get('type','post')!;site.saveType({...type.value,template:'documentation'},type.revision);site.saveEntry(page('guide',{kind:'content',blocks:[],document:{version:1,format:'markdown',source:'## 安装\n\n步骤。\n\n### Windows\n\n说明。'}}),null);const release=site.publish(),html=renderEntryTemplate(release.entries[0],release);expect(html).toContain('aria-label="正文目录"');const links=[...html.matchAll(/href="#([^"]+)"/g)].map((match)=>match[1]);expect(links).toHaveLength(2);for(const id of links)expect(html).toContain('id="'+id+'"');
  });
});
