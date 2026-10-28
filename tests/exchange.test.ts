import { afterEach, describe, expect, it } from 'vitest';
import { Site, exportSite, importSite } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/exchange-' + Date.now();
const sites: Site[] = [];
let sequence = 0;
function create() { const site = new Site(base + '/' + sequence++); sites.push(site);
  site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null); return site; }
afterEach(() => sites.splice(0).forEach((site) => site.close()));
const entry = (id: string) => entrySchema.parse({ id, kind: 'content', title: id, path: '/' + id + '/', categories: ['写作'] });
describe('atomic site exchange', () => {
  it('round trips into an initialized site including settings and stable terms, then imports identically without duplication', () => {
    const source = create(); const settings = source.settings();
    source.saveSettings({ ...settings.value, name: '导出的站点' }, settings.revision);
    source.saveEntry(entry('one'), null);
    const data = exportSite(source), target = create();
    const report = importSite(target, data);
    expect(report.imported).toBe(1); expect(target.settings().value.name).toBe('导出的站点');
    expect(target.store.get('entry', 'one')!.value.termIds.categories).toHaveLength(1);
    expect(target.release()).toBeNull();
    expect(importSite(target, exportSite(target)).created).toEqual([]);
    expect(importSite(target, exportSite(target)).updated).toEqual([]);
    const serialized = JSON.parse(JSON.stringify(exportSite(target)));
    serialized.entries = serialized.entries.map((entry: any) => Object.fromEntries(Object.entries(entry).reverse()));
    expect(importSite(target, serialized).updated).toEqual([]);
  });
  it('dry runs the whole write path while leaving settings, content, terms and revisions unchanged', () => {
    const source = create(); source.saveEntry(entry('one'), null);
    const target = create(), before = JSON.stringify(exportSite(target));
    const revision = target.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get();
    expect(importSite(target, exportSite(source), { dryRun: true }).created).toContain('entry:one');
    expect(JSON.stringify(exportSite(target))).toBe(before);
    expect(target.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get()).toEqual(revision);
  });
  it('rejects conflicts before writing earlier valid objects and merges only with an exact revision', () => {
    const site = create(); const one = site.saveEntry(entry('one'), null);
    const value = { version: 1 as const, entries: [entry('new'), { ...one.value, title: '改稿' }] };
    expect(() => importSite(site, value)).toThrow(/冲突/);
    expect(site.store.get('entry', 'new')).toBeNull();
    expect(() => importSite(site, value, { mode: 'merge', revisions: { 'entry:one': one.revision + 1 } })).toThrow(/冲突/);
    expect(importSite(site, value, { mode: 'merge', revisions: { 'entry:one': one.revision } }).updated).toEqual(['entry:one']);
    expect(site.store.get('entry', 'one')!.value.title).toBe('改稿');
  });
  it('rolls valid preceding rows back when a later entry fails validation and resolves child terms independent of source ordering', () => {
    const site = create();
    expect(() => importSite(site, { version: 1, entries: [entry('valid'), { ...entry('invalid'), type: 'missing' }] })).toThrow(/类型不存在/);
    expect(site.store.get('entry', 'valid')).toBeNull(); expect(site.terms()).toHaveLength(0);
    importSite(site, { version: 1, terms: [
      { id: 'child', kind: 'category', label: '子分类', slug: 'child', parentId: 'parent' },
      { id: 'parent', kind: 'category', label: '父分类', slug: 'parent' },
    ] });
    expect(site.store.get('term', 'child')!.value.parentId).toBe('parent');
  });
});
