import { afterEach, describe, expect, it } from 'vitest';
import { Site, mediaGroups, saveMediaGroup, moveMedia, queryMedia, saveMediaMetadata } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const sites: Site[] = [], root = 'D:/Tools/cache/weava/tests/media-groups-' + Date.now(); let sequence = 0;
const create = () => { const site = new Site(root + '/' + sequence++); sites.push(site); return site; };
afterEach(() => sites.splice(0).forEach((site) => site.close()));
const media = (site: Site, id: string) => site.store.put('media', id, { id, name: id + '.txt', url: '/media/' + id + '.txt', derivatives: [], createdAt: '2026-10-30', archived: false }, null);
describe('media organization without moving files', () => {
  it('renames and archives groups while preserving identity, membership and URLs', () => {
    const site = create(), group = saveMediaGroup(site, { id: 'images', label: '插图' }, null), file = media(site, 'a');
    const moved = moveMedia(site, [{ id: file.id, revision: file.revision }], group.id)[0];
    expect(moved.value.url).toBe(file.value.url);
    expect(queryMedia(site, new URLSearchParams('group=images')).total).toBe(1);
    const renamed = saveMediaGroup(site, { ...group.value, label: '图片', archived: true }, group.revision);
    expect(mediaGroups(site)[0].id).toBe(group.id); expect(queryMedia(site, new URLSearchParams()).total).toBe(1);
    expect(() => moveMedia(site, [{ id: moved.id, revision: moved.revision }], group.id)).toThrow(/归档/);
    const info = saveMediaMetadata(site, moved.id, { name: '改名.txt', groupId: group.id }, moved.revision); expect(info.value.url).toBe(file.value.url);
    saveMediaGroup(site, { ...renamed.value, archived: false }, renamed.revision);
    expect(queryMedia(site, new URLSearchParams('group=images')).items[0].value.name).toBe('改名.txt');
  });
  it('moves selected records atomically and supports ungrouped filters', () => {
    const site = create(), group = saveMediaGroup(site, { id: 'images', label: '插图' }, null), a = media(site, 'a'), b = media(site, 'b');
    expect(() => moveMedia(site, [{ id: a.id, revision: a.revision }, { id: b.id, revision: 0 }], group.id)).toThrow(/变化/);
    expect(site.store.get('media', a.id)!.revision).toBe(a.revision);
    expect(queryMedia(site, new URLSearchParams('group=__ungrouped__')).total).toBe(2);
    const moved = moveMedia(site, [a, b].map((row) => ({ id: row.id, revision: row.revision })), group.id);
    expect(queryMedia(site, new URLSearchParams('group=images&q=b')).total).toBe(1);
    moveMedia(site, moved.map((row) => ({ id: row.id, revision: row.revision })), null);
    expect(queryMedia(site, new URLSearchParams('group=__ungrouped__')).total).toBe(2);
    expect(() => moveMedia(site, [{ id: a.id, revision: a.revision }], 'missing')).toThrow(/不存在/);
  });
  it('does not touch content or the public version when grouping and rejects stale metadata', () => {
    const site = create(), file = media(site, 'a');
    const row = site.saveEntry(entrySchema.parse({ id: 'page', kind: 'page', title: '页面', path: '/page/', document: { version: 1, format: 'markdown', source: '' } }), null);
    const release = site.publish({ ids: [row.id] }), group = saveMediaGroup(site, { id: 'docs', label: '文档' }, null);
    expect(() => saveMediaGroup(site, { id: 'duplicate', label: '文档' }, null)).toThrow(/同名/);
    moveMedia(site, [{ id: file.id, revision: file.revision }], group.id);
    expect(() => saveMediaMetadata(site, file.id, { name: 'old.txt' }, file.revision)).toThrow(/变化/);
    expect(site.release()!.id).toBe(release.id); expect(site.store.get('entry', row.id)!.revision).toBe(row.revision);
  });
});
