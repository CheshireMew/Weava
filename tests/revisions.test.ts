import { afterEach, describe, expect, it } from 'vitest';
import { Site, entryChanges, entryRevision, mergeEntry, saveMergedEntry } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const sites: Site[] = [], base = 'D:/Tools/cache/weava/tests/revisions-' + Date.now();
let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); return site; };
const entry = () => entrySchema.parse({ id: 'page', kind: 'page', title: '原始标题', path: '/page/', fields: { one: 'A', two: 'B' }, document: { version: 1, format: 'markdown', source: '原始正文' }, status: 'published' });
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('revision review and concurrent editing recovery', () => {
  it('reads immutable versions belonging to exactly one entry, and restores a new draft without publishing', () => {
    const site = create(), first = site.saveEntry(entry(), null), release = site.publish();
    const second = site.saveEntry({ ...first.value, title: '第二版' }, first.revision);
    expect(entryRevision(site, first.id, first.revision).value.title).toBe('原始标题');
    expect(() => entryRevision(site, 'other', first.revision)).toThrow(/版本不存在/);
    const restored = site.restore(first.id, first.revision, second.revision);
    expect(restored.revision).toBeGreaterThan(second.revision); expect(restored.value.status).toBe('draft');
    expect(site.release()!.id).toBe(release.id); expect(site.history(first.id)).toHaveLength(3);
  });
  it('merges disjoint edits against their common source, including separate custom fields', () => {
    const site = create(), first = site.saveEntry(entry(), null);
    const server = site.saveEntry({ ...first.value, title: '服务器标题', fields: { one: '服务器 A', two: 'B' } }, first.revision);
    const local = { ...first.value, description: '本地摘要', fields: { one: 'A', two: '本地 B' } };
    const plan = mergeEntry(site, first.id, first.revision, local);
    expect(plan.conflicts).toEqual([]); expect(plan.merged).toMatchObject({ title: '服务器标题', description: '本地摘要', fields: { one: '服务器 A', two: '本地 B' } });
    const saved = saveMergedEntry(site, { id: first.id, baseRevision: first.revision, currentRevision: server.revision, value: local });
    expect(saved.value.fields).toEqual(plan.merged.fields);
  });
  it('requires explicit choices for concurrent changes to the same body or block array', () => {
    const site = create(), first = site.saveEntry(entry(), null);
    const server = site.saveEntry({ ...first.value, document: { ...first.value.document, source: '服务器正文' } }, first.revision);
    const local = { ...first.value, document: { ...first.value.document, source: '本地正文' } };
    const args = { id: first.id, baseRevision: first.revision, currentRevision: server.revision, value: local };
    expect(mergeEntry(site, first.id, first.revision, local).conflicts.map((row) => row.path)).toEqual(['/document']);
    expect(() => saveMergedEntry(site, args)).toThrow(/逐|每处/);
    expect(site.store.get('entry', first.id)!.revision).toBe(server.revision);
    const merged = saveMergedEntry(site, { ...args, choices: { '/document': 'local' } });
    expect(merged.value.document.source).toBe('本地正文'); expect(entryRevision(site, first.id, server.revision).value.document.source).toBe('服务器正文');
  });
  it('refuses a stale comparison or different identity before any write', () => {
    const site = create(), first = site.saveEntry(entry(), null);
    const second = site.saveEntry({ ...first.value, title: '服务器第一改' }, first.revision);
    const third = site.saveEntry({ ...second.value, title: '服务器第二改' }, second.revision);
    expect(() => saveMergedEntry(site, { id: first.id, baseRevision: first.revision, currentRevision: second.revision, value: { ...first.value, description: '本地摘要' } })).toThrow(/再次变化/);
    expect(() => mergeEntry(site, first.id, first.revision, { ...first.value, id: 'other' })).toThrow(/编号/);
    expect(site.store.get('entry', first.id)!.revision).toBe(third.revision);
  });
  it('ignores timestamp and object key order in comparisons, preserving absent optional fields', () => {
    const a = entry(), b = { ...a, fields: { two: 'B', one: 'A' }, updatedAt: '2026-10-29T00:00:00Z' };
    expect(entryChanges(a, b)).toEqual([]);
    expect(entryChanges(a, { ...b, template: 'page' })).toEqual([{ path: '/template', before: undefined, after: 'page' }]);
  });
  it('chooses an entire document when concurrent edits changed its format, preserving a valid editor state', () => {
    const site = create(), first = site.saveEntry(entry(), null);
    const server = site.saveEntry({ ...first.value, document: { version: 1, format: 'lexical', source: { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '可视化正文' }] }] } } } }, first.revision);
    const local = { ...first.value, document: { ...first.value.document, source: '另一个 Markdown 正文' } };
    const plan = mergeEntry(site, first.id, first.revision, local); expect(plan.conflicts[0].path).toBe('/document'); expect(plan.conflicts[0].remoteHtml).toContain('可视化正文');
    const saved = saveMergedEntry(site, { id: first.id, baseRevision: first.revision, currentRevision: server.revision, value: local, choices: { '/document': 'remote' } });
    expect(saved.value.document.format).toBe('lexical');
  });
});
