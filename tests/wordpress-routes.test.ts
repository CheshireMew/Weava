import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entrySchema } from '@weava/contracts';
import { Site, queryEntries, pageMetadata, metadataHead, renderEntryTemplate, wordpressArchiveEntry, pageLinks } from '@weava/core';
import { migrateWordPressRoutes } from '../packages/core/src/migrate-wordpress-routes.ts';
import { wordpressCompatibilityExtension } from '../packages/core/src/wordpress-compat.ts';
import { sourceContentHash, originalWordPressImages } from '../packages/core/src/source-content.ts';
import sharp from 'sharp';
import { uploadMedia } from '../packages/core/src/media.ts';
import { digest } from '../packages/core/src/storage.ts';

it('supplements old public routes, preserves edited article bodies, publishes aliases and refuses later edits', async () => {
  const folder = (process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/wordpress-routes-' + Date.now();
  mkdirSync(folder, { recursive: true });
  const target = join(folder, 'site'), input = join(folder, 'routes.json');
  const originalDate = '2025-12-01T00:00:00.000Z';
  const site = new Site(target);
  site.saveSettings({ ...site.settings().value, domain: 'https://example.test' }, site.settings().revision);
  site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
  for (let n = 1; n <= 6; n++) {
    const entry = entrySchema.parse({ id: 'wordpress:' + n, title: '文章 ' + n, path: '/posts/' + n + '/', kind: 'content', author: n < 5 ? 'Alice' : 'Bob', status: 'published',
      document: { version: 1, format: 'markdown', source: '正文 ' + n }, publishedAt: originalDate,
      source: { system: 'wordpress', id: String(n), modifiedAt: originalDate } });
    entry.source!.importedContentHash = sourceContentHash(entry);
    const row = site.saveEntry(entry, null);
    site.store.put('import', row.id, { targetRevision: row.revision }, null);
  }
  site.saveEntry(entrySchema.parse({ id: 'wordpress:home', kind: 'page', title: '博客', path: '/', status: 'published' }), null);
  site.publish();
  site.store.put('redirect', '/?p=1', { target: '/posts/1/', entryId: 'wordpress:1' }, null);
  const first = site.store.get('entry', 'wordpress:1')!;
  site.saveEntry({ ...first.value, document: { version: 1, format: 'markdown', source: '# 站主已经编辑的正文' } }, first.revision);
  const routes: any[] = [
    { path: '/', kind: 'archive', title: '博客', archive: { pageSize: 2, titleTemplate: '博客 - 第{page}页 共{pages}页' } },
    { path: '/archive/', kind: 'archive', title: '归档', archive: { pageSize: 2 } },
    { path: '/about/', kind: 'page', title: '关于', sourceId: '20', html: '<p>原页面内容</p>' },
    { path: '/moments/21.html', kind: 'moment', title: '短动态', sourceId: '21', html: '<h2 id="pk-menu-1">原段落</h2><p>动态正文</p>', modifiedAt: originalDate },
    { path: '/author/alice/', kind: 'archive', title: 'Alice', archive: { author: 'Alice', pageSize: 2 } },
    ...Array.from({ length: 6 }, (_, i) => ({ path: '/posts/' + (i + 1) + '/', kind: 'article', title: '文章 ' + (i + 1) })),
  ].map(route => ({ ...route, documentTitle: route.title + ' - 旧博客', description: '原搜索摘要', canonical: 'https://example.test' + route.path, indexable: true }));
  writeFileSync(input, JSON.stringify({ schema: 'wordpress-routes-v1', origin: 'https://example.test', capturedAt: new Date().toISOString(),
    sitemaps: ['/sitemap_index.xml'], randomPaths: ['/random/'],
    robotsText: 'User-agent: *\nDisallow:\nSitemap: https://example.test/sitemap_index.xml\n',
    sitemapGroups: [{path: '/post-sitemap.xml', paths: routes.filter(r=>r.kind==='article').map(r=>r.path)}], routes }));
  site.close();
  const preview = await migrateWordPressRoutes(input, target, true);
  expect(preview.conflicts).toEqual([]);
  const report = await migrateWordPressRoutes(input, target);
  expect(report.published).toBe(true);
  const updated = new Site(target);
  try {
    const release = updated.release()!;
    expect(updated.redirect(new URL('https://example.test/?p=1'))).toBe('/posts/1/');
    const original = release.entries.find(entry => entry.id === 'wordpress:2')!;
    expect(original.modifiedAt).toBe(originalDate);
    const edited = release.entries.find(entry => entry.id === 'wordpress:1')!;
    expect(edited.document.source).toBe('# 站主已经编辑的正文');
    expect(renderEntryTemplate(edited, release).match(/<h1\b/g)?.length).toBe(1);
    expect(edited.modifiedAt).not.toBe(originalDate);
    expect(pageMetadata(original, release, new URL(original.path, release.settings.domain)).title).toBe('文章 2 - 旧博客');
    expect(queryEntries(release.entries, { author: 'Alice', kind: 'content' }, release.types).total).toBe(4);
    const extension = (await import('data:text/javascript;base64,' + Buffer.from(wordpressCompatibilityExtension).toString('base64'))).default({ queryEntries });
    const request = (path: string) => extension.route(new Request('https://example.test' + path), release);
    expect(await request('/page/2/')).toBeNull();
    const numbered = wordpressArchiveEntry(release, new URL('https://example.test/page/2/'))!;
    expect(numbered.id).toBe('wordpress:home');
    expect(pageMetadata(numbered, release, new URL('https://example.test/page/2/'))).toMatchObject({
      canonical: 'https://example.test/page/2/', title: '博客 - 第2页 共3页', robots: 'index,follow',
    });
    expect(pageLinks({page: 2, pages: 3, pageSize: 2, total: 6, items: []}, new URL('https://example.test/page/2/'), 'page', numbered)).toEqual({previous:'/',next:'/page/3/'});
    const numberedHtml = renderEntryTemplate(numbered, release, {}, {url:new URL('https://example.test/page/2/')});
    expect(numberedHtml).toContain('href="/page/3/"');
    expect(numberedHtml).not.toContain('?page=');
    const newsletterRelease = { ...release, settings: { ...release.settings, theme: 'newsletter' },
      entries: release.entries.map(entry => entry.path === '/' ? { ...entry, template: 'newsletter-home', blocks: [] } : entry) };
    const newsletterPage = wordpressArchiveEntry(newsletterRelease, new URL('https://example.test/page/2/'))!;
    expect(newsletterPage.template).toBe('newsletter-archive');
    expect(newsletterPage.blocks[0].props.limit).toBe(2);
    expect(pageMetadata(newsletterPage, newsletterRelease, new URL('https://example.test/page/2/')).canonical).toBe('https://example.test/page/2/');
    expect(pageMetadata(newsletterPage, newsletterRelease, new URL('https://example.test/?page=2')).canonical).toBe('https://example.test/?page=2');
    const newsletterHtml = renderEntryTemplate(newsletterPage, newsletterRelease, {}, { url: new URL('https://example.test/page/2/') });
    expect(newsletterHtml.match(/class="card"/g)).toHaveLength(2);
    expect(newsletterHtml).toContain('href="/page/3/"');
    const queryHtml = renderEntryTemplate(newsletterPage, newsletterRelease, {}, { url: new URL('https://example.test/?page=2') });
    expect(queryHtml).toContain('<span>2 / 3</span>');
    expect(newsletterRelease.entries.find(entry => entry.path === '/')!.blocks).toEqual([]);
    expect((await request('/page/1/?utm_source=old'))!.headers.get('location')).toBe('/?utm_source=old');
    expect((await request('/page/999/'))!.status).toBe(404);
    expect((await request('/author/alice/page/3/'))!.status).toBe(404);
    expect((await request('/archive/?page=999'))!.status).toBe(404);
    const index = await request('/sitemap_index.xml');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('https://example.test/post-sitemap.xml');
    const sitemap = await request('/post-sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect((await sitemap.text()).match(/<url>/g)?.length).toBe(6);
    expect(await (await request('/robots.txt')).text()).toContain('/sitemap_index.xml');
    expect((await request('/moments/21.html/'))!.headers.get('location')).toBe('/moments/21.html');
    expect((await request('/random/'))!.status).toBe(302);
    expect(await request('/posts/1/')).toBeNull();
    expect((await request('/archive/?page=2')).headers.get('location')).toBe('/archive/page/2/');
    const moment = release.entries.find(entry => entry.type === 'wordpress-moment')!;
    expect(moment.html).toContain('id="pk-menu-1"');
    expect(moment.source?.renderedBodySha256).toBe(digest('<h2 id="pk-menu-1">原段落</h2><p>动态正文</p>'));
    const unicode = await extension.route(new Request('https://example.test/moments/%E4%B8%AD%E6%96%87.html/'),
      { ...release, entries: [...release.entries, { ...moment, path: '/moments/中文.html' }] });
    expect(unicode.headers.get('location')).toBe('/moments/%E4%B8%AD%E6%96%87.html');
    expect(() => new Response(null, { status: 301, headers: { location: unicode.headers.get('location')! } })).not.toThrow();
    const compatible = structuredClone(release);
    compatible.entries.find(entry=>entry.path==='/')!.source!.wordpressCompatibility.httpRedirects = [{path:'/moments/21.html',target:'/moments/21.html/',status:301}];
    compatible.entries.find(entry=>entry.path==='/moments/21.html')!.source!.wordpressResponsePath='/moments/21.html/';
    expect((await extension.route(new Request('https://example.test/moments/21.html'),compatible)).headers.get('location')).toBe('/moments/21.html/');
    expect(await extension.route(new Request('https://example.test/moments/21.html/'),compatible)).toBeNull();
    expect(wordpressArchiveEntry(compatible,new URL('https://example.test/moments/21.html/'))?.path).toBe('/moments/21.html');
    const excluded=pageMetadata({...original,indexable:false,source:{wordpressSeo:{canonicalPresent:false}}},release,new URL('https://example.test/excluded/'));
    expect(excluded.robots).toBe('noindex,follow');
    expect(metadataHead(excluded)).not.toContain('<link rel="canonical"');
  } finally { updated.close(); }
  expect((await migrateWordPressRoutes(input, target)).published).toBe(false);
  const edited = new Site(target);
  const about = edited.store.list('entry').find(row => row.value.path === '/about/')!;
  edited.saveEntry({ ...about.value, title: '站主修改关于页' }, about.revision);
  edited.close();
  await expect(migrateWordPressRoutes(input, target)).rejects.toThrow('目标内容存在修改');
});

it('encodes WordPress query redirects before writing HTTP response headers', () => {
  const site = new Site((process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/wordpress-unicode-' + Date.now());
  try {
    site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
    site.saveEntry(entrySchema.parse({ id: 'chinese', kind: 'content', title: '中文', path: '/posts/中文/', status: 'published' }), null);
    site.saveEntry(entrySchema.parse({ id: 'front', kind: 'page', title: '首页', path: '/', status: 'published' }), null);
    site.store.put('redirect', '/?p=1', { target: '/posts/中文/', entryId: 'chinese' }, null);
    site.store.put('redirect', '/?page_id=9', { target: '/', entryId: 'front' }, null);
    site.publish();
    const destination = site.redirect(new URL('https://example.test/?p=1&utm_source=test'))!;
    expect(destination).toBe('/posts/%E4%B8%AD%E6%96%87/?utm_source=test');
    expect(() => new Response(null, { status: 301, headers: { Location: destination } })).not.toThrow();
    expect(site.redirect(new URL('https://example.test/?page_id=9'))).toBe('/');
  } finally { site.close(); }
});

it('keeps verified WordPress rendered text and resolves theme-lazy images to downloaded media', async () => {
  const root = (process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/wordpress-rendered-' + Date.now(), input = root + '/routes.json';
  const site = new Site(root + '/site');
  site.saveSettings({ ...site.settings().value, domain: 'https://example.test' }, site.settings().revision);
  site.saveType({ id:'post', label:'文章', fields:[], pathPrefix:'/posts/', template:'article' }, null);
  const entry = entrySchema.parse({ id:'wordpress:1',kind:'content',title:'原文章',path:'/post/',status:'published',
    document:{version:1,format:'markdown',source:'原始 Markdown'},source:{system:'wordpress',id:'1',modifiedAt:'2025-12-01T00:00:00.000Z'} });
  entry.source!.importedContentHash = sourceContentHash(entry);
  const row = site.saveEntry(entry, null); site.store.put('import',row.id,{targetRevision:row.revision},null);site.publish();
  const image = await sharp({create:{width:12,height:12,channels:3,background:'#315c4c'}}).png().toBuffer();
  const media = await uploadMedia(site,image,'old.png');
  mkdirSync(root+'/site/imports/wordpress',{recursive:true});
  const external='https://pbs.twimg.com/media/old?format=png&name=large';
  writeFileSync(root+'/site/imports/wordpress/media-url-map.json',JSON.stringify([{source_url:external,sha256:digest(image)}]));
  const html='<p>“原排版” **保留字面符号**</p><img src="/wp-content/themes/old/load.svg" data-src="'+external.replaceAll('&','&amp;')+'">';
  writeFileSync(input,JSON.stringify({schema:'wordpress-routes-v1',origin:'https://example.test',capturedAt:new Date().toISOString(),routes:[{
    path:'/post/',kind:'article',title:'原文章',html,documentTitle:'原搜索标题',description:'',canonical:'https://example.test/post/',indexable:true,
  }]}));site.close();
  await migrateWordPressRoutes(input,root+'/site');
  const updated = new Site(root+'/site');
  try {
    const entry = updated.release()!.entries[0];
    expect(entry.document.format).toBe('lexical');
    const source = JSON.stringify(entry.document.source);
    expect(source).toContain('“原排版” **保留字面符号**');
    expect(source).toContain(media.value.url);
    expect(source).not.toContain('data-src');
    expect(source).not.toContain('load.svg');
    expect(originalWordPressImages(renderEntryTemplate(entry, updated.release()!), entry)).toContain(external.replaceAll('&','&amp;'));
    expect(entry.modifiedAt).toBe('2025-12-01T00:00:00.000Z');
  } finally { updated.close(); }
  expect((await migrateWordPressRoutes(input,root+'/site')).published).toBe(false);
});
