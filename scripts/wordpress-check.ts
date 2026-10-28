import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Site, digest, normalizePath, renderDocument, plain } from '@weava/core';
import { load } from 'cheerio';

if (!process.argv[2] || !process.argv[3]) throw new Error('用法：node --import tsx scripts/wordpress-check.ts <站点目录> <WordPress 导出目录> [本地网址]');
const root = resolve(process.argv[2]);
const source = resolve(process.argv[3]);
const base = process.argv[4] ?? 'http://127.0.0.1:4324';
const read = (file: string) => JSON.parse(readFileSync(file,'utf8').replace(/^\ufeff/,''));
const articles = read(join(source,'articles.json')) as any[];
const media = read(join(source,'media-url-map.json')) as any[];
const site = new Site(root);
const rows = site.store.list('entry');
const release = site.visibleRelease()!;
const ownerRelease = site.visibleRelease(true)!;
const paths: string[] = [], mediaUrls = new Set<string>();
let bodyChecks = 0, coverChecks = 0;
try {
  for (const article of articles) {
    if (article.status === 'auto-draft' && !article.source_fields.post_content) continue;
    const row = rows.find((r) => r.id === 'wordpress:'+article.id)!;
    assert(row, 'Missing article '+article.id);
    const original = readFileSync(join(source,article.body_file),'utf8');
    assert.equal(digest(original), article.body_sha256);
    assert.equal(row.value.source.originalBodySha256, article.body_sha256);
    const originalText = plain(renderDocument({ version:1,format:'markdown',source:original })).replace(/[ \t]*\{\.alignnone\}/g,'').replace(/\s+/g,' ').trim();
    assert.equal(plain(renderDocument(row.value.document)), originalText, 'Visible text differs: '+article.id);
    assert.equal(row.value.visibility, article.status === 'private' ? 'private' : 'public');
    assert.equal(row.value.author, article.author?.display_name ?? '');
    assert.deepEqual(row.value.categories, article.categories.map((t:any)=>t.name));
    assert.deepEqual(row.value.tags, article.tags.map((t:any)=>t.name));
    if (article.status === 'publish') {
      assert.equal(row.value.path, normalizePath(new URL(article.original_url).pathname));
      paths.push(row.value.path);
      if (article.cover_local_path) {
        const image = media.find((m)=>m.local_path===article.cover_local_path);
        assert.equal(digest(readFileSync(join(root,row.value.cover.slice(1)))), image.sha256);
        coverChecks++;
      }
    } else assert(!release.entries.some((e)=>e.id===row.id));
    bodyChecks++;
  }
  const mediaRecords = site.store.list('media');
  for (const record of mediaRecords) {
    assert.equal(digest(readFileSync(join(root, record.value.url.slice(1)))),record.value.hash);
    if (!site.isPrivateMedia(record.value.url)) {
      mediaUrls.add(record.value.url);
      for (const derivative of record.value.derivatives) mediaUrls.add(derivative.url);
    }
  }
  const privateEntry = ownerRelease.entries.find((e)=>e.visibility==='private')!;
  assert(privateEntry);
  for (const path of [privateEntry.path,'/?p='+privateEntry.source!.id]) {
    const response = await fetch(base+path,{redirect:'manual'});
    if (path===privateEntry.path) assert.equal(response.status,404);
    else assert.notEqual(response.status,301);
    assert(!(await response.text()).includes(privateEntry.title));
  }
  const publicApi = await (await fetch(base+'/api/v1/content')).json() as any[];
  assert.equal(publicApi.length, paths.length);
  assert(!publicApi.some((e)=>e.id===privateEntry.id));
  assert(publicApi.every((e)=>!e.source));
  for (const path of ['/','/rss.xml','/sitemap.xml','/api/v1/search?q='+encodeURIComponent(privateEntry.title)]) {
    const response = await fetch(base+path); assert.equal(response.status,200);
    assert(!(await response.text()).includes(privateEntry.title), 'Private title leaked through '+path);
  }
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<paths.length) {
      const path=paths[cursor++]; const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      const $=load(await response.text());
      assert.equal($('.article-heading > h1').length,1,path+' missing article heading');
      assert.equal($('link[rel=canonical]').attr('href'),new URL(path, release.settings.domain).href);
      assert.equal($('img[src*="wp-content"],img[src*="pbs.twimg.com"]').length,0,path+' has remote article media');
    }
  }));
  cursor=0; const imagePaths=[...mediaUrls];
  await Promise.all(Array.from({length:6},async()=>{
    while(cursor<imagePaths.length) {
      const path=imagePaths[cursor++]; const response=await fetch(base+path,{method:'HEAD'});
      assert.equal(response.status,200,path);
    }
  }));
  const report = {passed:true,bodyChecks,publicArticlePaths:paths.length,coverChecks,mediaOriginals:mediaRecords.length,mediaHttpChecks:imagePaths.length,
    privateArticles:ownerRelease.entries.filter((e)=>e.visibility==='private').length,publicApiArticles:publicApi.length,source,root,base};
  mkdirSync(join(root,'imports'),{recursive:true});
  writeFileSync(join(root,'imports','wordpress-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {site.close();}
