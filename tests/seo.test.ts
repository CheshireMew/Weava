import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Site, Analytics, pageMetadata, metadataHead, composeMetadata, renderEntryTemplate, auditRelease, fetchAuditResponses, auditBasis, auditStatus, storeAudit, importSearchData, searchDataReport, pullSearchData, planSearchData, extension } from '@weava/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { load } from 'cheerio';
import { entrySchema } from '@weava/contracts';

const root = 'D:/Tools/cache/weava/tests/seo-' + Date.now();
const sites: Site[] = [];
let nextSite = 0;
const create = () => { const site = new Site(join(root, String(nextSite++))); sites.push(site);
  site.saveType({ id: 'post', label: '文章', pathPrefix: '/posts/', template: 'article', fields: [] }, null);
  const settings = site.settings(); site.saveSettings({ ...settings.value, domain: 'https://example.test' }, settings.revision); return site; };
const entry = (id: string, extra: any = {}) => entrySchema.parse({ id, kind: 'content', title: id, path: '/' + id + '/', status: 'published', document: { version: 1, format: 'markdown', source: '## 正文\n\n这是页面内容。' }, ...extra });
afterEach(() => { sites.splice(0).forEach((site) => site.close()); });

describe('search metadata and evidence publication', () => {
  it('keeps pagination canonical, removes tracking and separates search/filter indexing', () => {
    const site = create(); site.saveEntry(entry('list', { kind: 'page', blocks: [{ id: 'list', type: 'content-list', props: { pageKey: 'items' } }] }), null);
    const release = site.publish(), item = release.entries[0];
    expect(pageMetadata(item, release, new URL('https://example.test/list/?items=2&utm_source=x'))).toMatchObject({ canonical: 'https://example.test/list/?items=2', robots: 'index,follow' });
    expect(pageMetadata(item, release, new URL('https://example.test/list/?items=2&sort=popular'))).toMatchObject({ canonical: 'https://example.test/list/?items=2', robots: 'noindex,follow' });
    expect(pageMetadata(undefined, release, new URL('https://example.test/search/?q=test')).robots).toBe('noindex,follow');
    expect(pageMetadata(item, release, new URL('https://example.test/list/'), { preview: true }).robots).toBe('noindex,nofollow');
    expect(pageMetadata(item, release, new URL('https://example.test/list/?items=2&items=3')).robots).toBe('noindex,follow');
    const archive = { ...item, template: 'newsletter-archive', blocks: [] };
    expect(pageMetadata(archive, { ...release, settings: { ...release.settings, theme: 'newsletter' } }, new URL('https://example.test/list/?page=2')).canonical).toBe('https://example.test/list/?page=2');
  });
  it('publishes typed semantics, visible FAQ and the same verified facts in HTML and JSON-LD', () => {
    const site = create(); site.saveType({ id: 'software', label: '软件', pathPrefix: '/software/', template: 'article', fields: [], schemaType: 'SoftwareApplication' }, null);
    site.saveEntry(entry('app', { type: 'software', kind: 'page', seo: { title: '搜索标题', description: '独立搜索摘要' }, blocks: [{ id: 'faq', type: 'faq', props: { items: [{ question: '能做什么？', answer: '处理文档。' }] } }],
      evidence: [{ id: 'docs', claim: '处理文档', title: '官方文档', url: 'https://docs.example.test', status: 'verified', verifiedAt: '2026-01-01' }] }), null);
    const release = site.publish(), item = release.entries[0], html = renderEntryTemplate(item, release), meta = pageMetadata(item, release, new URL(item.path, release.settings.domain), { html });
    expect(html).toContain('官方文档');
    expect(meta.schema['@graph'].find((node: any) => node['@type'] === 'SoftwareApplication').citation[0].name).toBe('官方文档');
    expect(meta.schema['@graph'].find((node: any) => node['@type'] === 'FAQPage').mainEntity[0].name).toBe('能做什么？');
    expect(metadataHead(meta)).toContain('<title>搜索标题 · Weava</title>');
    expect(meta.schema['@graph'].some((node: any) => node.author?.name === 'Weava')).toBe(false);
  });
  it('invalidates reviewed evidence when its claim changes and excludes expired citations', () => {
    const site = create(); const row = site.saveEntry(entry('one', { evidence: [{ id: 'fact', claim: '原说法', url: 'https://example.test/source/', title: '来源', status: 'verified', verifiedAt: '2026-01-01', validUntil: '2026-01-02' }] }), null);
    const first = site.publish();
    expect(pageMetadata(first.entries[0], first, new URL('https://example.test/one/')).schema['@graph'].find((node: any) => node['@type'] === 'Article').citation).toBeUndefined();
    const changed = site.saveEntry({ ...row.value, evidence: [{ ...row.value.evidence[0], claim: '新说法' }] }, row.revision);
    expect(changed.value.evidence[0].status).toBe('pending');
    const verified = site.saveEntry({ ...changed.value, evidence: [{ ...changed.value.evidence[0], status: 'verified' }] }, changed.revision);
    expect(verified.value.evidence[0].status).toBe('verified');
    expect(() => site.saveEntry(entry('bad-date', { evidence: [{ id: 'x', claim: '', status: 'pending', verifiedAt: '2026-02-30' }] }), null)).toThrow(/有效/);
    expect(() => site.saveEntry(entry('bad', { seo: { canonical: 'javascript:alert(1)' } }), null)).toThrow();
  });
});

describe('actionable audits and revision binding', () => {
  it('reports real duplicate pages and does not turn missing responses into failed content checks', async () => {
    const site = create(); site.saveEntry(entry('one', { title: '重复' }), null); site.saveEntry(entry('two', { title: '重复' }), null); site.saveEntry(entry('private', { visibility: 'private' }), null);
    const release = site.publish(), report = await auditRelease(release);
    expect(report.coverage).toMatchObject({ eligible: 2, checked: 2, excludedPrivate: 1 });
    expect(report.findings.some((item) => item.rule === 'duplicate-title')).toBe(true);
    const unavailable = await auditRelease(release, { responses: { one: { status: 403 }, two: { status: 500 } } });
    expect(unavailable.coverage.checked).toBe(0);
    expect(unavailable.findings.every((item) => item.rule === 'unavailable')).toBe(true);
    const http = await auditRelease(release, { responses: Object.fromEntries(release.entries.filter((item) => item.visibility !== 'private').map((item) => [item.id, { status: 200, html: '<title>HTTP</title><h1>页面</h1><a href="/admin/">后台</a>' }])) });
    expect(http.findings.some((item) => item.rule === 'internal-link')).toBe(false);
  });
  it('keeps saved reports immutable and marks only the changed target stale', async () => {
    const site = create(), row = site.saveEntry(entry('one'), null), release = site.publish();
    const published = await auditRelease(release, { basis: auditBasis(site, 'published') });
    const draft = await auditRelease(release, { target: 'draft', basis: auditBasis(site, 'draft') });
    storeAudit(site, draft); expect(auditStatus(site, draft).stale).toBe(false);
    site.saveEntry({ ...row.value, title: '改稿' }, row.revision);
    expect(auditStatus(site, draft).stale).toBe(true); expect(auditStatus(site, published).stale).toBe(false);
    mkdirSync(join(site.root, 'extensions'), { recursive: true }); writeFileSync(join(site.root, 'extensions/manifest.json'), '{}');
    expect(auditStatus(site, published).stale).toBe(true);
  });
});

describe('source analytics and external datasets', () => {
  it('separates referral views, key actions and declared crawler requests on pages', () => {
    const site = create(), analytics = new Analytics(site.root), at = new Date().toISOString();
    try {
      const common = { ts: at, path: '/landing/', visitor: 'reader', session: 'session', referrer: 'https://chatgpt.com/', releaseId: 'release' };
      analytics.collect([{ ...common, id: 'view-source-fixture', kind: 'view' }, { ...common, id: 'event-source-fixture', kind: 'event', label: 'form:success' }], 'Browser', new Set(['/landing/']));
      analytics.recordCrawler('/landing/', 'OAI-SearchBot', 200);
      const report = analytics.report(new URLSearchParams());
      expect(report.views).toBe(1); expect(report.clicks).toBe(0); expect(report.sources[0].channel).toBe('ai-referral');
      expect(report.actions).toEqual([{ name: 'form:success', count: 1 }]); expect(report.crawlers[0].requests).toBe(1);
    } finally { analytics.close(); }
  });
  it('imports through storage idempotently, preserves attribution dimensions and rejects conflicting batches', () => {
    const site = create(); site.saveEntry(entry('one'), null); site.publish();
    expect(searchDataReport(site).status).toBe('not-connected');
    const input = { version: 1, id: 'batch', provider: 'gsc', property: 'sc-domain:example.test', start: '2026-01-01', end: '2026-01-01', collectedAt: '2026-01-02T00:00:00Z', kind: 'search-performance',
      rows: [{ url: 'https://example.test/one/', date: '2026-01-01', query: '问题', country: 'chn', device: 'mobile', clicks: 2, impressions: 10, position: 3 }] };
    expect(importSearchData(site, input).imported).toBe(1); expect(importSearchData(site, input).unchanged).toBe(true);
    const dataset = searchDataReport(site).datasets[0] as any;
    expect(dataset.ctr).toBe(0.2); expect(dataset.pages[0].entryId).toBe('one'); expect(dataset.pages[0].device).toBe('mobile');
    expect(() => importSearchData(site, { ...input, rows: [] })).toThrow(/不同内容/);
  });
  it('keeps browser/API observations and panels separate, and exposes missing planned samples', () => {
    const site = create(); site.saveEntry(entry('one'), null); site.publish();
    const input = { version: 1, id: 'observations', provider: 'manual', property: 'example.test', start: '2026-01-01', end: '2026-01-01', collectedAt: '2026-01-01T12:00:00Z', kind: 'ai-observations', expectedSamples: 3,
      rows: [{ id: 'one', platform: 'sample', model: 'v1', query: '问题', answer: '回答', citations: ['https://example.test/one/'], observedAt: '2026-01-01T12:00:00Z', locale: 'zh-CN', collectionMethod: 'browser', panelVersion: 'v1', status: 'answered' }] };
    importSearchData(site, input); const dataset = searchDataReport(site).datasets[0] as any;
    expect(dataset.missing).toBe(2); expect(dataset.groups[0].citationRateAmongAnswers).toBe(1);
    expect(dataset.observations[0]).toMatchObject({ query: '问题', answer: '回答', citations: ['https://example.test/one/'] });
    expect(() => importSearchData(site, { ...input, id: 'duplicate', rows: [input.rows[0], input.rows[0]] })).toThrow(/重复/);
  });
});

describe('optional connector wire contracts', () => {
  it('sends the documented GSC request and produces an importable dataset without credentials', async () => {
    const calls: any[] = [];
    const fetcher = (async (url: any, options: any) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ rows: [{ keys: ['https://example.test/one/', '问题', '2026-01-01', 'chn', 'MOBILE'], clicks: 2, impressions: 10, position: 3 }] }); }) as typeof fetch;
    const data = await pullSearchData({ provider: 'gsc', property: 'sc-domain:example.test', start: '2026-01-01', end: '2026-01-01', accessToken: 'test-only-token' }, fetcher);
    expect(calls[0].url).toContain('sc-domain%3Aexample.test'); expect(calls[0].body.dimensions).toContain('page');
    expect(JSON.stringify(data)).not.toContain('test-only-token'); expect(data.rows).toHaveLength(1);
    const site = create(); expect(importSearchData(site, data).rows).toBe(1);
  });
  it('does not issue paid requests without an explicit request budget', async () => {
    let calls = 0; const fetcher = (async () => { calls++; return Response.json({}); }) as typeof fetch;
    await expect(pullSearchData({ provider: 'dataforseo', property: 'https://example.test', start: '2026-01-01', end: '2026-01-01', keywords: ['one'] }, fetcher)).rejects.toThrow(/maxRequests/);
    expect(calls).toBe(0);
  });
  it('plans without credentials, bounds paid calls and retains partial charged results on failure', async () => {
    const today = new Date().toISOString().slice(0, 10), config = { provider: 'dataforseo' as const, property: 'https://example.test', start: today, end: today, keywords: ['one', 'two'], maxRequests: 2, locationCode: 2840, languageCode: 'en' };
    expect(planSearchData(config)).toMatchObject({ paid: true, requests: 2, estimatedCostUsd: null });
    let calls = 0;
    const fetcher = (async (_url, options) => { calls++; expect(JSON.parse(options!.body as string)[0]).toMatchObject({ depth: 100, location_code: 2840 });
      return calls === 1 ? Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [{ type: 'organic', url: 'https://example.test/one/', rank_absolute: 3 }] }] }] }) : new Response('', { status: 429 }); }) as typeof fetch;
    await expect(pullSearchData({ ...config, login: 'test-login', password: 'test-password' }, fetcher)).rejects.toThrow(/allowPaid/);
    await expect(pullSearchData({ ...config, allowPaid: 'false' as any, login: 'test-login', password: 'test-password' }, fetcher)).rejects.toThrow(/allowPaid/);
    expect(calls).toBe(0);
    try { await pullSearchData({ ...config, allowPaid: true, login: 'test-login', password: 'test-password' }, fetcher); throw new Error('should fail'); }
    catch (error: any) { expect(error.details).toMatchObject({ completedRequests: 1, requestedRequests: 2, knownCostUsd: 0.01, partialDataset: { rows: [{ rank: 3 }], expectedSamples: 2 } }); expect(JSON.stringify(error.details)).not.toContain('test-password'); }
    expect(calls).toBe(2);
  });
  it('maps GA4 wire dimensions and metrics without treating sessions as pageviews', async () => {
    const fetcher = (async (url, options) => { expect(String(url)).toContain('properties/123:runReport'); expect(JSON.parse(options!.body as string).metrics).toEqual([{ name: 'sessions' }, { name: 'keyEvents' }]);
      return Response.json({ rowCount: 1, rows: [{ dimensionValues: [{ value: 'https://example.test/one/' }, { value: '20260101' }, { value: 'Organic Search' }], metricValues: [{ value: '5' }, { value: '2' }] }] }); }) as typeof fetch;
    const dataset = await pullSearchData({ provider: 'ga4', property: '123', start: '2026-01-01', end: '2026-01-01', accessToken: 'test-only' }, fetcher);
    expect(dataset).toMatchObject({ kind: 'web-analytics', rows: [{ date: '2026-01-01', sessions: 5, keyEvents: 2 }] });
  });
});

describe('extension metadata and HTTP audit boundaries', () => {
  it('uses active extension contributions, preserves custom graph details and emits one authoritative head', async () => {
    const site = create(); site.saveEntry(entry('one'), null); const release = site.publish(), item = release.entries[0];
    mkdirSync(join(site.root, 'extensions'), { recursive: true });
    writeFileSync(join(site.root, 'extensions/index.mjs'), `export default () => ({id:'test-seo',apiVersion:1,metadata:()=>({title:'扩展标题',schemaType:'TechArticle',schema:[{'@type':'BreadcrumbList',itemListElement:[]}]})});`);
    const manager = await extension(site), meta = await manager.metadata(item, release, new URL(item.path, release.settings.domain));
    const $ = load(composeMetadata('<html><head><title>旧标题</title><link rel="canonical" href="https://old.test"><script type="application/ld+json">{"@type":"Article","headline":"旧标题","wordCount":50}</script></head><body><h1>正文</h1><script>old()</script></body></html>', meta, { preview: true }));
    expect($('title').text()).toContain('扩展标题'); expect($('link[rel="canonical"]')).toHaveLength(1); expect($('script').not('[type="application/ld+json"]')).toHaveLength(0);
    const graph = JSON.parse($('script[data-weava-seo]').html()!)['@graph'];
    expect(graph.find((node: any) => node['@type'] === 'TechArticle').wordCount).toBe(50); expect(graph.some((node: any) => node['@type'] === 'BreadcrumbList')).toBe(true);
    expect(graph.some((node: any) => node['@type'] === 'Article')).toBe(false);
    await manager.stop();
  });
  it('limits fetched pages, excludes private content, and reports unrequested responses as unknown', async () => {
    const site = create(); site.saveEntry(entry('one'), null); site.saveEntry(entry('two'), null); site.saveEntry(entry('private', { visibility: 'private' }), null); const release = site.publish();
    const urls: string[] = [], fetcher = (async (url) => { urls.push(String(url)); return new Response('<html><title>Response</title><body><main><h1>Response</h1></main></body></html>'); }) as typeof fetch;
    const responses = await fetchAuditResponses(release, 'http://127.0.0.1:4321', 1, fetcher), report = await auditRelease(release, { responses });
    expect(urls).toHaveLength(1); expect(urls[0]).toContain('127.0.0.1:4321'); expect(report.coverage).toMatchObject({ checked: 1, unavailable: 1, excludedPrivate: 1, source: 'http-response' });
    expect(report.findings.some((item) => item.rule === 'orphan')).toBe(false);
  });
  it('follows actual pagination before judging unlinked pages and stops at the total request budget', async () => {
    const site = create(); site.saveEntry(entry('one', { kind: 'page' }), null); const release = site.publish(), urls: string[] = [];
    const fetcher = (async (value) => { const url = String(value); urls.push(url); return new Response(url.includes('page=2') ? '<h1>第二页</h1>' : '<h1>首页</h1><a rel="next" href="?page=2">下一页</a>'); }) as typeof fetch;
    const responses = await fetchAuditResponses(release, 'http://127.0.0.1:4321', 2, fetcher);
    expect(urls).toHaveLength(2); expect(urls[1]).toContain('page=2');
    expect((await auditRelease(release, { responses })).coverage.paginationChecked).toBe(1);
    const bounded = await auditRelease(release, { responses: await fetchAuditResponses(release, 'http://127.0.0.1:4321', 1, fetcher) });
    expect(bounded.coverage.linkDiscoveryComplete).toBe(false);
  });
});
