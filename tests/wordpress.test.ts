import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Site, digest, Analytics } from '@weava/core';
import { migrateWordPress, migrateWordPressViews } from '../packages/core/src/migrate-wordpress.ts';

it('imports WordPress Markdown, paths, covers and privacy without duplicating or overwriting edited articles', async () => {
  const base = 'D:/Tools/cache/weava/tests/wordpress-' + Date.now(), source = join(base,'source'), target = join(base,'target');
  mkdirSync(join(source,'media'),{ recursive:true });
  mkdirSync(join(source,'articles'),{ recursive:true });
  const image = await sharp({ create:{ width:20,height:20,channels:3,background:'#315c4c' } }).png().toBuffer();
  writeFileSync(join(source,'media/photo.png'),image);
  const body = '## 原文\n\n![封面](https://blog.example.com/wp-content/uploads/photo.png){.alignnone}\n\n[https://blog.example.com](https://blog.example.com)\n\n```text\n[https://blog.example.com](https://blog.example.com)\n```';
  writeFileSync(join(source,'articles/1.md'),body);
  writeFileSync(join(source,'articles/2.md'),'私密内容');
  const article = (id:string,status:string) => ({ id,status,title:'原文章 '+id,slug:'post-'+id,
    original_url:status==='private'?'https://blog.example.com/?p='+id:'https://blog.example.com/write/post-'+id+'/',
    source_fields:{ post_content:id==='1'?body:'私密内容' }, body_file:'articles/'+id+'.md',body_sha256:digest(id==='1'?body:'私密内容'),
    categories:[{ term_id:'1',slug:'write',name:'写作' }],tags:[],postmeta:{ _wp_old_slug:['older-'+id] },
    created_at_gmt:'2025-12-01 00:00:00',modified_at_gmt:'2026-01-01 00:00:00',
    cover_local_path:id==='1'?'media/photo.png':null,author:{ display_name:'作者' } });
  const json = (file:string,value:unknown) => writeFileSync(join(source,file),JSON.stringify(value));
  json('wordpress-source.json',{ schema:'wordpress-source-export-v1',options:{ home:'https://blog.example.com',blogname:'博客',blogdescription:'内容',WPLANG:'zh_CN',timezone_string:'Asia/Shanghai' } });
  json('articles.json',[article('1','publish'),article('2','private')]);
  json('media-url-map.json',[{ source_url:'https://blog.example.com/wp-content/uploads/photo.png',original_urls:[],local_path:'media/photo.png',status:'verified',sha256:digest(image) }]);
  const dry = await migrateWordPress(source,target,true);
  expect(dry.privateArticles).toBe(1);
  await migrateWordPress(source,target);
  const site = new Site(target);
  const first = site.store.get('entry','wordpress:1')!;
  expect(first.value.document.source).toContain('/media/'+digest(image).slice(0,24)+'.png');
  expect(first.value.document.source).toContain('[https://blog.example.com](/)');
  expect(first.value.document.source).not.toContain('{.alignnone}');
  expect(first.value.document.source).toContain('```text\n[https://blog.example.com](https://blog.example.com)\n```');
  expect(first.value.path).toBe('/write/post-1/');
  expect(first.value.publishedAt).toBe('2025-12-01T00:00:00Z');
  expect(site.store.get('entry','wordpress:2')!.value.visibility).toBe('private');
  expect(site.visibleRelease()!.entries.some((e)=>e.id==='wordpress:2')).toBe(false);
  expect(site.redirect(new URL('https://blog.example.com/write/older-1/'))).toBe('/write/post-1/');
  const releaseId = site.release()!.id;
  site.close();
  expect((await migrateWordPress(source,target) as any).changed).toBe(false);
  json('views.json',{ schema:'wordpress-view-totals-v1',sourceId:'wordpress:example:views',capturedAt:'2026-10-28T00:00:00Z',entries:[{postId:'1',views:120},{postId:'2',views:3}] });
  const imported = await migrateWordPressViews(join(source,'views.json'),target);
  expect(imported.views).toBe(123);
  expect(imported.publicViews).toBe(120);
  expect((await migrateWordPressViews(join(source,'views.json'),target)).changed).toBe(0);
  const analytics = new Analytics(target);
  expect(analytics.report(new URLSearchParams()).views).toBe(0);
  expect(analytics.lifetime().lifetimeViews).toBe(123);
  analytics.close();
  const editedSite = new Site(target);
  expect(editedSite.release()!.id).toBe(releaseId);
  editedSite.saveEntry({ ...first.value,title:'站主修改' },first.revision);
  editedSite.close();
  await expect(migrateWordPress(source,target)).rejects.toThrow(/目标存在修改/);
  expect(readFileSync(join(source,'articles/1.md'),'utf8')).toBe(body);
});
