import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { defaultSettings, entrySchema, siteSeoSchema, typeSchema, type Release } from '@weava/contracts';
import { Site, pageMetadata, auditRelease, importSearchData, storeAudit, renderEntryBody, renderBreadcrumbs } from '@weava/core';
import { validatePagePagination } from '../packages/core/src/public-pagination.ts';
import { publicDocumentResponse } from '../apps/web/src/public-documents.ts';
import { publicUrlRedirect } from '../packages/core/src/public-url.ts';
import { fetchAuditBatch, type CrawlState } from '../packages/core/src/seo-crawl.ts';
import { PublicResponseCache, conditionalPublicResponse } from '../packages/core/src/public-response-cache.ts';
import { seoInsights } from '../packages/core/src/seo-insights.ts';
import { googleRobotRules, robotsBlocks } from '../packages/core/src/seo-robots.ts';
import { structuredDataIssues } from '../packages/core/src/seo-structured-data.ts';
import { adminApi } from '@weava/contracts/api';

const article = (id: string, extra: any = {}) => ({ ...entrySchema.parse({ id, kind: 'content', type: 'post', title: id, path: `/${id}/`, status: 'published', ...extra }), revisionId: 1, modifiedAt: '2026-10-01T00:00:00Z', html: '<p>Body</p>' });
const release = (entries: ReturnType<typeof article>[], extra: any = {}): Release => ({ id: 'release-1', label: '', createdAt: '2026-11-11T00:00:00Z', settings: { ...defaultSettings, domain: 'https://example.test' },
  types: [typeSchema.parse({ id: 'post', label: '文章', fields: [] })], entries, terms: [], ...extra });
const url = (path: string) => new URL(path, 'https://example.test');
const sites: Site[] = [];
afterEach(() => sites.splice(0).forEach(site => site.close()));

it('shares pagination metadata and bounds across collections, notes, shared lists and newsletter archives', () => {
  const posts = Array.from({ length: 25 }, (_, i) => article('post-' + i));
  const collection = article('collection', { kind: 'page', blocks: [{ id: 'list', type: 'collection', props: { limit: 10, presentation: 'catalog' } }] });
  const notes = article('notes', { kind: 'page', template: 'notes-feed' });
  const data = release([...posts, collection, notes], { settings: { ...defaultSettings, domain: 'https://example.test', theme: 'library' } });
  expect(pageMetadata(collection, data, url('/collection/?page=2&utm_source=test'))).toMatchObject({ canonical: 'https://example.test/collection/page/2/', indexable: true });
  expect(pageMetadata({ ...collection, path: '/collection/page/2/' }, data, url('/collection/page/2/')).canonical).toBe('https://example.test/collection/page/2/');
  expect(pageMetadata(collection, release([...posts, collection]), url('/collection/?page=2')).indexable).toBe(false);
  expect(() => validatePagePagination(collection, data, url('/collection/?page=3'))).not.toThrow();
  expect(() => validatePagePagination(collection, data, url('/collection/?page=4'))).toThrow('分页不存在');
  const noteData = release([...posts, notes]);
  expect(pageMetadata(notes, noteData, url('/notes/?page=2')).canonical).toContain('page=2');
  expect(() => validatePagePagination(notes, noteData, url('/notes/?page=3'))).toThrow('分页不存在');
  expect(pageMetadata(notes, data, url('/notes/?page=2')).indexable).toBe(false);
  const shared = article('shared', { kind: 'page', blocks: [
    { id: 'ref', type: 'shared', props: { layoutId: 'list-region' } },
    { id: 'short-list', type: 'cards', props: { pageKey: 'items', limit: 100 } },
  ] });
  const region = { id: 'list-region', kind: 'region', blocks: [{ id: 'list', type: 'content-list', props: { pageKey: 'items', limit: 12 } }] };
  const sharedData = release([...posts, shared], { layouts: [region] });
  expect(pageMetadata(shared, sharedData, url('/shared/?items=2')).pagination).toEqual({ items: 2 });
  expect(() => validatePagePagination(shared, sharedData, url('/shared/?items=2'))).not.toThrow();
  expect(() => validatePagePagination(shared, sharedData, url('/shared/?items=4'))).toThrow();
  const archive = article('archive', { kind: 'page', template: 'newsletter-archive', blocks: [] });
  const newsletter = release([...posts, archive], { settings: { ...data.settings, theme: 'newsletter' } });
  expect(() => validatePagePagination(archive, newsletter, url('/archive/?page=2'))).not.toThrow();
  expect(() => validatePagePagination(archive, newsletter, url('/archive/?page=3'))).toThrow();
  expect(pageMetadata(posts[0], data, url('/post-0/?page=2')).indexable).toBe(false);
  expect(pageMetadata(collection, data, url('/collection/?page=2&page=3')).indexable).toBe(false);
});

it('keeps sitemap aligned with private, noindex, canonical overrides and actual modification dates', async () => {
  const a = article('a'), b = article('b', { seo: { canonical: '/a/' } }), hidden = article('private', { visibility: 'private' }), excluded = article('excluded', { indexable: false });
  const data = release([a, b, hidden, excluded]);
  let xml = await publicDocumentResponse(data, url('/sitemap.xml'))!.text();
  const $ = load(xml, { xmlMode: true });
  expect($('loc').map((_i, el) => $(el).text()).get()).toEqual(['https://example.test/a/']);
  expect($('lastmod').text()).toBe('2026-10-01');
  const metadata = new Map([[a.id, { ...pageMetadata(a, data, url('/a/')), canonical: 'https://external.test/original/' }]]);
  xml = await publicDocumentResponse(data, url('/sitemap.xml'), metadata)!.text();
  expect(xml).not.toContain('<url>');
  const videos = release(data.entries.map(entry => ({ ...entry, html: '<video src="/media/video.mp4"></video>' })));
  const videoPath = url('/sitemap-videos.xml');
  expect(await publicDocumentResponse(videos, videoPath)!.text()).toContain('<loc>https://example.test/a/</loc>');
  expect(await publicDocumentResponse(videos, videoPath, metadata)!.text()).not.toContain('<url>');
});

it('normalizes public URL paths and production origins while preserving local tools, private paths and queries', () => {
  const data = release([article('a'), article('private', { visibility: 'private' }), article('chinese', { path: '/中文/' })]);
  expect(publicUrlRedirect(new Request('http://127.0.0.1:4322/a?utm_source=x'), data, { enforceOrigin: true })).toBe('/a/?utm_source=x');
  expect(publicUrlRedirect(new Request('http://www.example.test/a/?q=x'), data, { enforceOrigin: true })).toBe('https://example.test/a/?q=x');
  expect(publicUrlRedirect(new Request('http://example.test/a/', { headers: { host: 'example.test' } }), data, { protocol: 'https:', enforceOrigin: true })).toBeNull();
  expect(publicUrlRedirect(new Request('http://localhost/private'), data)).toBeNull();
  expect(publicUrlRedirect(new Request('http://localhost/unknown'), data)).toBeNull();
  expect(publicUrlRedirect(new Request('http://localhost/a', { method: 'POST' }), data)).toBeNull();
  const chinese = '/%E4%B8%AD%E6%96%87/';
  expect(publicUrlRedirect(new Request('https://example.test' + chinese), data, { enforceOrigin: true })).toBeNull();
  const location = publicUrlRedirect(new Request('https://example.test/中文?q=x'), data);
  expect(location).toBe(chinese + '?q=x');
  expect(new Response(null, { status: 301, headers: { Location: location! } }).headers.get('location')).toBe(location);
});

it('resumes bounded HTTP audits and carries headers, robots, sitemaps and duplicate evidence across batches', async () => {
  const data = release([article('a'), article('b'), article('c', { seo: { canonical: '/broken/' } }),
    article('chinese', { path: '/中文/' }), article('private', { path: '/私密/', visibility: 'private' })]);
  const visited: string[] = [];
  const fetcher = (async (value: any) => {
    const path = new URL(String(value)).pathname; visited.push(path);
    if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /a/\nSitemap: https://example.test/sitemap.xml', { headers: { 'Content-Type': 'text/plain' } });
    if (path === '/sitemap.xml') return new Response('<urlset><url><loc>https://example.test/a/</loc></url><url><loc>https://example.test/b/</loc></url></urlset>', { headers: { 'Content-Type': 'application/xml' } });
    if (path === '/broken/') return new Response('Missing', { status: 404, headers: { 'Content-Type': 'text/html' } });
    const canonical = path === '/c/' ? '/broken/' : path;
    return new Response(`<html><head><title>Same title</title><meta name="description" content="${path}"><link rel="canonical" href="https://example.test${canonical}"></head><body><main><h1>${path}</h1><a href="/custom/">Custom</a><a href="/中文/">Chinese</a><a href="/私密/">Private</a></main></body></html>`, { headers: { 'Content-Type': 'text/html', ...(path === '/b/' ? { 'X-Robots-Tag': 'noindex' } : {}) } });
  }) as typeof fetch;
  let state: CrawlState | undefined, previous: Awaited<ReturnType<typeof auditRelease>> | undefined;
  do {
    const batch = await fetchAuditBatch(data, 'http://127.0.0.1:4322', { maxPages: 2, paths: ['/custom/'], previous: state, fetcher });
    expect(Object.keys(batch.responses).length).toBeLessThanOrEqual(2);
    previous = await auditRelease(data, { responses: batch.responses, previous, crawl: batch.state, customPaths: ['/custom/'] });
    state = batch.state;
    if (!state.complete) expect(previous.coverage.linkDiscoveryComplete).toBe(false);
  } while (!state.complete);
  expect(visited).not.toContain(url('/私密/').pathname);
  expect(new Set(visited).size).toBe(visited.length);
  expect(previous!.pages.find(page => page.id === 'b')?.indexable).toBe(false);
  expect(previous!.pages.some(page => page.path === '/custom/')).toBe(true);
  expect(previous!.pages.find(page => page.id === 'chinese')).toMatchObject({ status: 'checked', path: '/中文/' });
  expect(previous!.findings.some(finding => finding.rule === 'orphan' && finding.entryId === 'chinese')).toBe(false);
  for (const rule of ['robots-blocked', 'sitemap-policy', 'canonical-target', 'duplicate-title']) expect(previous!.findings.some(finding => finding.rule === rule), rule).toBe(true);
  expect(adminApi.seoAudits.response.parse([{ ...previous!, stale: false }])[0].crawl?.complete).toBe(true);
  await expect(fetchAuditBatch({ ...data, id: 'different' }, 'http://127.0.0.1:4322', { previous: state, fetcher })).rejects.toThrow('已变化');
});

it('honors Google-specific HTTP and robots rules, and validates structured breadcrumb fields', () => {
  expect(googleRobotRules('otherbot: noindex, googlebot: nofollow')).not.toContain('noindex');
  expect(googleRobotRules('noindex, max-snippet:20')).toContain('noindex');
  expect(robotsBlocks('User-agent: *\nDisallow: /\nAllow: /public/', '/public/a/')).toBe(false);
  expect(robotsBlocks('User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /', '/a/')).toBe(false);
  expect(robotsBlocks('User-agent: *\nDisallow: /*?sort=*$', '/a/?sort=x')).toBe(true);
  expect(structuredDataIssues('<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"position":2,"name":"x"}]}</script>')[0].rule).toBe('schema-content');
  const parent = article('parent', { documentation: { group: 'docs' } }), child = article('child', { documentation: { group: 'docs', parentId: 'parent' } });
  const data = release([parent, child]);
  const graph = pageMetadata(child, data, url('/child/')).schema['@graph'];
  expect(graph.find((node: any) => node['@type'] === 'BreadcrumbList').itemListElement.map((node: any) => node.item)).toEqual(['https://example.test/parent/', 'https://example.test/child/']);
  const html = load(renderBreadcrumbs(child, data));
  expect(html('nav a').attr('href')).toBe('/parent/');
  expect(html('nav [aria-current="page"]').text()).toBe(child.title);
  expect(renderBreadcrumbs(parent, data)).toBe('');
});

it('resolves stable entry references when a theme renders the article body directly', () => {
  const target = article('target', { path: '/new-path/' });
  const item = { ...article('source'), html: '<p><a href="entry:target#details">Read more</a></p>' };
  expect(load(renderEntryBody(item, release([target, item])))('a').attr('href')).toBe('/new-path/#details');
});

it('applies site and type SEO templates dynamically, with explicit single-entry values taking priority', () => {
  const item = article('a'), data = release([item], { types: [typeSchema.parse({ id: 'post', label: '文章', fields: [], seoTemplates: { title: '{title} | {siteName}', description: '{type}：{description}' } })] });
  const meta = pageMetadata(item, data, url('/a/'));
  expect(meta.title).toBe('a | Weava'); expect(meta.description).toContain('文章：');
  expect(pageMetadata({ ...item, seo: { documentTitle: 'Manual', description: 'Explicit' } }, data, url('/a/'))).toMatchObject({ title: 'Manual', description: 'Explicit' });
  expect(siteSeoSchema.safeParse({ templates: { title: '{unsupported}' } }).success).toBe(false);
});

it('uses a content image for the share card and keeps branding as a fallback', () => {
  const post = article('a'), home = article('home', { kind: 'page', path: '/' });
  const settings = { ...defaultSettings, domain: 'https://example.test', description: '网站简介', logo: '/logo.png',
    seo: { templates: { description: '{description}' } } };
  const data = release([post, home], { settings });
  const metadata = pageMetadata(post, data, url('/a/'));
  expect(metadata).toMatchObject({ title: 'a · Weava', description: '', image: 'https://example.test/logo.png' });
  expect(metadata.schema['@graph'].find((node: any) => node['@type'] === 'Article')).not.toHaveProperty('image');
  expect(pageMetadata(home, data, url('/')).description).toBe('网站简介');
  const image = (entry = post, seo: typeof defaultSettings.seo = settings.seo) => pageMetadata(entry, { ...data, settings: { ...settings, seo } }, url('/a/')).image;
  expect(image(post, { ...settings.seo, image: '/default.png' })).toBe('https://example.test/default.png');
  const illustrated = { ...post, html: '<p><img src="/body.png" alt=""></p>' };
  expect(image(illustrated, { ...settings.seo, image: '/default.png' })).toBe('https://example.test/body.png');
  expect(image({ ...illustrated, cover: '/cover.png' })).toBe('https://example.test/cover.png');
  expect(image({ ...illustrated, seo: { image: '/share.png' } })).toBe('https://example.test/share.png');
  expect(pageMetadata(post, { ...data, settings: { ...settings, logo: '' } }, url('/a/')).image).toBe('');
});

it('bounds cache memory and lifetime, invalidates publication generations and honors ETag without mixing login states', async () => {
  const cache = new PublicResponseCache(), req = new Request('https://example.test/sitemap.xml');
  const first = cache.key(req, 'one'); await cache.remember(first, new Response('<urlset/>', { headers: { 'Content-Type': 'application/xml' } }), 0);
  expect(await cache.get(first, 1)!.text()).toBe('<urlset/>'); expect(cache.get(first, 60001)).toBeNull();
  expect(cache.key(new Request(req, { headers: { Cookie: 'session=x' } }), 'one')).toBeNull();
  expect(cache.key(new Request('https://example.test/a/'), 'one')).toBeNull();
  expect(cache.key(new Request('https://example.test/a/'), 'one', 10)).not.toBeNull();
  cache.key(req, 'two'); expect(cache.get(first, 1)).toBeNull();
  await cache.remember(first, new Response('Old version', { headers: { 'Content-Type': 'application/xml' } }), 1);
  expect(cache.get(cache.key(req, 'two'), 2)).toBeNull();
  const response = conditionalPublicResponse(req, new Response('Body'), 'Body');
  const unchanged = conditionalPublicResponse(new Request(req, { headers: { 'If-None-Match': response.headers.get('ETag')! } }), new Response('Body'), 'Body');
  expect(unchanged.status).toBe(304);
  expect(conditionalPublicResponse(new Request(req, { method: 'HEAD' }), new Response('Body'), 'Body').body).toBeNull();
});

it('deduplicates imported search observations, separates dimensions and returns revision-bound maintenance suggestions', () => {
  const site = new Site(join(process.env.WEAVA_TEST_OUTPUT ?? 'D:/Tools/cache/weava/tasks/seo-foundation-20261111/tests', randomUUID())); sites.push(site);
  site.saveType(typeSchema.parse({ id: 'post', label: '文章', fields: [] }), null);
  const settings = site.settings(); site.saveSettings({ ...settings.value, domain: 'https://example.test' }, settings.revision);
  for (const id of ['a', 'b']) site.saveEntry(article(id, { path: id === 'a' ? '/中文/' : '/b/', evidence: [{ id: 'source', claim: 'Fact', status: 'pending' }] }), null);
  const published = site.publish();
  const dataset = (id: string, collectedAt: string, rows: any[]) => ({ version: 1, id, collectedAt, provider: 'gsc', property: 'sc-domain:example.test', kind: 'search-performance', start: '2026-10-01', end: '2026-11-01', rows });
  const rows = [{ url: url('/中文/').href, date: '2026-10-31', query: 'topic', clicks: 1, impressions: 200, position: 12 }, { url: 'https://example.test/b/', date: '2026-10-31', query: 'topic', clicks: 2, impressions: 100, position: 14 }, { url: url('/中文/').href, date: '2026-10-03', query: 'topic', clicks: 30, impressions: 200, position: 8 }];
  importSearchData(site, dataset('old', '2026-11-01T00:00:00Z', rows));
  importSearchData(site, dataset('new', '2026-11-02T00:00:00Z', [{ ...rows[0], clicks: 2 }]));
  importSearchData(site, dataset('other-dimensions', '2026-11-02T00:00:00Z', [{ ...rows[0], query: undefined, clicks: 5 }]));
  const report = seoInsights(site, { start: '2026-10-05', end: '2026-11-01' });
  expect(report.groups).toHaveLength(2);
  const group = report.groups.find(group => group.dimensions.includes('query'))!;
  expect(group.pages.find(page => page.entryId === 'a')?.current.clicks).toBe(2);
  expect(group.suggestions.map(item => item.kind)).toEqual(expect.arrayContaining(['review-click-through', 'near-first-page', 'review-decline', 'review-query-overlap']));
  expect(report.maintenance[0].revision).toBe(published.entries[0].revisionId);
  expect(() => seoInsights(site, { end: 'invalid' })).toThrow('有效');
});
