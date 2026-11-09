import { afterEach, describe, expect, it,vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { Site, uploadMedia, saveMediaMetadata, archiveMedia, cropMedia, mediaReferences, queryMedia, saveLayout, renderDocument, imageAttributes, responsiveImages, entryCover, queryDrafts } from '@weava/core';
import { imageDerivatives } from '../packages/core/src/media-images.ts';
import { entrySchema } from '@weava/contracts';
import * as documents from '../packages/core/src/documents.ts';
import {mediaReferencesIn} from '../packages/core/src/media-references.ts';
const sites: Site[] = [], base = (process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/media-edit-' + Date.now();
let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); return site; };
const image = () => sharp({ create: { width: 800, height: 400, channels: 3, background: '#337755' } }).png().toBuffer();
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('media library editing', () => {
  it('saves and publishes ordered lists containing links without interpreting numeric attributes as URLs',async()=>{
    const site=create(),file=await uploadMedia(site,Buffer.from('ordered list attachment'),'notes.txt');
    const row=site.saveEntry(entrySchema.parse({id:'ordered-links',kind:'page',title:'有序列表',path:'/ordered-links/',document:{version:1,format:'markdown',source:`3. [附件](${file.value.url})\n4. 第二项\n\n下一段\n\n9. [同一附件](${file.value.url})`}}),null);
    expect([...mediaReferencesIn(row.value)]).toContain(file.value.url);
    const released=site.publish({ids:[row.id]}).entries.find(entry=>entry.id===row.id)!;
    expect(released.html).toContain('<ol start="3">');expect(released.html).toContain('<ol start="9">');expect(released.html).toContain(file.value.url);
  });
  it('saves drafts and indexes their images without rendering or highlighting the document',()=>{
    const site=create(),render=vi.spyOn(documents,'renderDocument');
    try{
      const row=site.saveEntry(entrySchema.parse({id:'fast-draft',kind:'page',title:'草稿',path:'/fast-draft/',document:{version:1,format:'markdown',source:'```js\nconst value=1;\n```\n\n![图片][photo]\n\n[photo]: </media/my photo.png>'}}),null);
      expect(render).not.toHaveBeenCalled();expect(entryCover(row.value)).toBe('/media/my%20photo.png');
      expect(mediaReferencesIn(row.value)).toContain('/media/my%20photo.png');
      expect(()=>site.publish({ids:[row.id]})).toThrow(/引用/);expect(render).toHaveBeenCalled();
    }finally{render.mockRestore();}
  });
  it('crops in the displayed orientation without an intermediate full-size PNG',async()=>{
    const site=create(),bytes=await sharp({create:{width:800,height:400,channels:3,background:'#335577'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const original=await uploadMedia(site,bytes,'rotated.jpg');
    const crop=await cropMedia(site,original.id,original.revision,{left:25,top:25,width:50,height:50});
    expect(crop.value).toMatchObject({width:200,height:400,parentId:original.id,optimization:{status:'pending'}});
  });
  it('uses the first real body image when no cover is set and follows later body edits without saving a cover', () => {
    const site = create(), value = entrySchema.parse({ id: 'automatic-cover', kind: 'content', type: 'post', title: '自动封面', path: '/automatic-cover/', document: { version: 1, format: 'markdown', source: '```md\n![example](https://example.com/code.png)\n```\n\n![first](https://example.com/first.png)\n\n![second](https://example.com/second.png)' } });
    site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
    expect(entryCover(value)).toBe('https://example.com/first.png');
    expect(entryCover({ ...value, cover: 'https://example.com/manual.png' })).toBe('https://example.com/manual.png');
    const row = site.saveEntry(value, null);
    expect(queryDrafts(site).items[0].value.cover).toBe('https://example.com/first.png');
    expect(site.store.get('entry', row.id)!.value.cover).toBe('');
    site.saveEntry({ ...row.value, document: { version: 1, format: 'html', source: '<p>Updated</p><img src="https://example.com/new.png">' } }, row.revision);
    expect(queryDrafts(site).items[0].value.cover).toBe('https://example.com/new.png');
    expect(entryCover({ ...value, blocks: [{ id: 'container', type: 'container', props: {}, children: [{ id: 'image', type: 'image', props: { src: 'https://example.com/block.png' } }] }] })).toBe('https://example.com/block.png');
    expect(entryCover({ ...value, document: { version: 1, format: 'lexical', source: { root: { type: 'root', children: [{ type: 'image', src: 'https://example.com/editor.png', kind: 'image' }] } } } })).toBe('https://example.com/editor.png');
    expect(entryCover({ ...value, document: { version: 1, format: 'markdown', source: 'Only text' } })).toMatch(/^\/default-covers\/picsum-\d+\.webp$/);
  });
  it('preserves readable native sizes, avoids larger display copies and leaves animation intact', async () => {
    const site = create(), bytes = await image(), row = await uploadMedia(site, bytes, 'readable.png');
    expect(row.value.derivatives.map((item: any) => item.width)).toEqual([480, 800]);
    expect(imageAttributes(site, row.value.url).srcset).toContain('800w');
    expect(imageAttributes(site, row.value.url, 64).src).toBe(row.value.derivatives[0].url);
    expect(imageAttributes(site, row.value.url, {width:32,height:32})).toMatchObject({src:row.value.derivatives[0].url,width:32,height:32,sizes:'32px'});
    expect(imageAttributes(site, row.value.url).src).toBe(row.value.derivatives.at(-1).url);
    const html = responsiveImages(site, `<img src="${row.value.url}" width="32" height="32"><img src="${row.value.url}" loading="eager">`);
    expect(html).toContain('width="32" height="32"'); expect(html).toContain('loading="lazy"'); expect(html).toContain('loading="eager"'); expect(html).toContain('decoding="async"');
    for (const item of row.value.derivatives) {
      const metadata = await sharp(site.root + item.url).metadata();
      expect(metadata.width).toBe(item.width);
      expect(item.bytes).toBeLessThan(bytes.length);
    }
    expect(readFileSync(site.root + row.value.url)).toEqual(bytes);
    const efficient = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#00000000' } }).webp({ quality: 82 }).toBuffer();
    const small = await uploadMedia(site, efficient, 'small.webp');
    expect(small.value.derivatives).toEqual([]);
    expect(imageAttributes(site, small.value.url).src).toBe(small.value.url);
    // Build a real two-frame GIF so the uploaded media's metadata detects animation.
    const gif = await sharp({ create: { width: 20, height: 40, channels: 3, background: '#ff0000' } })
      .raw().toBuffer();
    gif.fill(0, 20 * 20 * 3);
    const animated = await sharp(gif, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    const motion = await uploadMedia(site, animated, 'motion.gif');
    expect(motion.value.derivatives).toEqual([]);
    expect(readFileSync(site.root + motion.value.url)).toEqual(animated);
    expect(await imageDerivatives(site.root, bytes, row.id, await sharp(bytes).metadata(), bytes.length, row.value.derivatives)).toEqual(row.value.derivatives);
  });
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
    expect(cropped.value.derivatives).toEqual([]);expect(cropped.value.optimization.status).toBe('pending');expect(site.jobs().some(job=>job.operation==='media-optimize'&&job.payload.id===cropped.id)).toBe(true); expect(readFileSync(site.root + original.value.url)).toEqual(bytes);
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
