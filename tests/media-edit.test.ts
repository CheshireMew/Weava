import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { Site, uploadMedia, saveMediaMetadata, archiveMedia, cropMedia, mediaReferences, queryMedia, saveLayout, renderDocument } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const sites: Site[] = [], base = 'D:/Tools/cache/weava/tests/media-edit-' + Date.now();
let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); return site; };
const image = () => sharp({ create: { width: 800, height: 400, channels: 3, background: '#337755' } }).png().toBuffer();
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('media library editing', () => {
  it('edits metadata with revision protection, searches and archives batches atomically without removing files', async () => {
    const site = create(), first = await uploadMedia(site, await image(), '原图.png');
    const updated = saveMediaMetadata(site, first.id, { name: '作品图.png', alt: '作品说明', caption: '作品图注' }, first.revision);
    expect(() => saveMediaMetadata(site, first.id, { name: '旧窗口.png' }, first.revision)).toThrow(/变化/);
    expect(() => saveMediaMetadata(site, first.id, { name: 4 as any }, updated.revision)).toThrow(/无效/);
    expect(queryMedia(site, new URLSearchParams({ q: '作品', kind: 'image' })).total).toBe(1);
    expect(() => archiveMedia(site, [{ id: first.id, revision: updated.revision }, { id: 'missing', revision: 1 }], true)).toThrow();
    expect(site.store.get('media', first.id)!.value.archived).toBeUndefined();
    const archived = archiveMedia(site, [{ id: first.id, revision: updated.revision }], true)[0];
    expect(queryMedia(site, new URLSearchParams()).total).toBe(0);
    expect(queryMedia(site, new URLSearchParams({ archived: 'true' })).total).toBe(1);
    expect(existsSync(site.root + first.value.url)).toBe(true);
    archiveMedia(site, [{ id: first.id, revision: archived.revision }], false);
    expect(queryMedia(site, new URLSearchParams()).total).toBe(1);
  });
  it('makes an accurately sized crop while preserving original bytes, metadata, derivatives and ancestry', async () => {
    const site = create(), bytes = await image(), original = await uploadMedia(site, bytes, 'picture.png');
    const metadata = saveMediaMetadata(site, original.id, { name: 'picture.png', alt: '原图说明', caption: '原图图注' }, original.revision);
    const cropped = await cropMedia(site, original.id, metadata.revision, { left: 25, top: 25, width: 50, height: 50 });
    expect(cropped.id).not.toBe(original.id); expect(cropped.value).toMatchObject({ width: 400, height: 200, parentId: original.id, alt: '原图说明', caption: '原图图注' });
    expect(cropped.value.derivatives.length).toBeGreaterThan(0); expect(readFileSync(site.root + original.value.url)).toEqual(bytes);
    expect((await cropMedia(site, original.id, metadata.revision, { left: 25, top: 25, width: 50, height: 50 })).id).toBe(cropped.id);
    await expect(cropMedia(site, original.id, metadata.revision, { left: 90, top: 0, width: 50, height: 20 })).rejects.toThrow(/范围/);
  });
  it('finds references through templates and shared regions, and preserves private crop access until explicitly published', async () => {
    const site = create(), original = await uploadMedia(site, await image(), 'secret.png');
    const cropped = await cropMedia(site, original.id, original.revision, { left: 0, top: 0, width: 50, height: 50 });
    saveLayout(site, { id: 'private-region', label: '私密图区', kind: 'region', appliesTo: 'any', blocks: [{ id: 'image', type: 'image', props: { src: original.value.url } }] }, null);
    site.saveEntry(entrySchema.parse({ id: 'private', kind: 'page', title: '私密作品', path: '/private/', status: 'published', visibility: 'private', blocks: [{ id: 'shared', type: 'shared', props: { layoutId: 'private-region' } }] }), null);
    site.publish();
    expect(mediaReferences(site, original.id)).toMatchObject({ working: [{ id: 'private' }], published: [{ id: 'private' }], layouts: [{ id: 'private-region' }] });
    expect(site.isPrivateMedia(original.value.url)).toBe(true); expect(site.isPrivateMedia(cropped.value.url)).toBe(true);
    for (const derivative of cropped.value.derivatives) expect(site.isPrivateMedia(derivative.url)).toBe(true);
    const publicEntry = site.saveEntry(entrySchema.parse({ id: 'public', kind: 'page', title: '公开图', path: '/public/', blocks: [{ id: 'image', type: 'image', props: { src: cropped.value.url } }] }), null);
    site.publish({ ids: [publicEntry.id], revisions: { [publicEntry.id]: publicEntry.revision } });
    expect(site.isPrivateMedia(cropped.value.url)).toBe(false); expect(site.isPrivateMedia(original.value.url)).toBe(true);
  });
  it('renders image, audio, video and attachment metadata from rich text', () => {
    const html = renderDocument({ version: 1, format: 'lexical', source: { root: { type: 'root', children: ['image', 'audio', 'video', 'file'].map((kind) => ({ type: 'image', src: '/media/item.' + (kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'pdf'), altText: '说明', kind, caption: '图注' })) } } });
    expect(html).toContain('<audio'); expect(html).toContain('<video'); expect(html).toContain('图注'); expect(html).toContain('说明'); expect(html).toContain('.pdf');
  });
  it('keeps media in historical private regions private after the shared region changes',async()=>{
    const site=create(),original=await uploadMedia(site,await image(),'private-history.png');const region=saveLayout(site,{id:'private-history',label:'私密历史',kind:'region',appliesTo:'any',blocks:[{id:'photo',type:'image',props:{src:original.value.url}}]},null);site.saveEntry(entrySchema.parse({id:'private',kind:'page',title:'私密页',path:'/private/',visibility:'private',status:'published',blocks:[{id:'shared',type:'shared',props:{layoutId:region.id}}]}),null);site.publish();saveLayout(site,{...region.value,blocks:[]},region.revision);site.publish({scope:'layouts'});expect(site.isPrivateMedia(original.value.url)).toBe(true);
  });
});
