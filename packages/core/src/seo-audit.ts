import { load } from 'cheerio';
import type { Entry, Release } from '@weava/contracts';
import { digest } from './storage.ts';
import { pageMetadata, metadataHead, composeMetadata, evidenceCurrent, type PageMetadata } from './seo.ts';
import { renderEntryTemplate } from './render.ts';
import type { Site } from './site.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export async function fetchAuditResponses(release: Release, origin: string, maxPages = 200, fetcher: typeof fetch = fetch) {
  const responses: Record<string, { html?: string; status: number; error?: string }> = {};
  const entries = release.entries.filter((entry) => entry.visibility !== 'private').slice(0, maxPages);
  const queue = entries.map((entry) => ({ key: entry.id, url: new URL(entry.path, origin).href })), seen = new Set(queue.map((item) => item.url));
  const paths = new Set(entries.map((entry) => entry.path));
  for (let offset = 0; offset < queue.length;) { const batch = queue.slice(offset, offset + 4); offset += batch.length; await Promise.all(batch.map(async (item) => {
    try {
      const response = await fetcher(item.url, { redirect: 'manual', headers: { 'User-Agent': 'Weava-Site-Audit/1' }, signal: AbortSignal.timeout(8000) });
      const html = await response.text();
      responses[item.key] = { status: response.status, ...(html.length <= 2_000_000 ? { html } : { error: '响应超过 2 MB 检查预算。' }) };
      if (response.ok && html.length <= 2_000_000) load(html)('a[rel="next"],a[rel="prev"]').each((_i, element) => {
        const href = element.attribs.href; if (!href) return;
        const url = new URL(href, item.url); url.hash = '';
        if (url.origin !== new URL(origin).origin || !paths.has(url.pathname) || seen.has(url.href)) return;
        seen.add(url.href); const key = 'url:' + url.href;
        if (queue.length < maxPages) queue.push({ key, url: url.href });
        else responses[key] = { status: 0, error: '分页未读取：达到页面检查预算。' };
      });
    } catch { responses[item.key] = { status: 0, error: '读取失败或超时，请检查服务后重试。' }; }
  })); }
  return responses;
}

export interface SeoFinding { id: string; rule: string; severity: 'error' | 'warning' | 'info'; entryId: string; path: string; message: string; action: string; evidence: string }
export interface SeoAudit {
  id: string; rulesVersion: 1; createdAt: string; releaseId: string; basis: string; target: 'draft' | 'published';
  coverage: { eligible: number; checked: number; unavailable: number; excludedPrivate: number; source: string; paginationChecked: number; linkDiscoveryComplete: boolean };
  pages: { id: string; path: string; revision: number; status: 'checked' | 'unavailable'; indexable?: boolean; canonical?: string }[];
  findings: SeoFinding[];
}
export function auditBasis(site: Site, target: SeoAudit['target']) {
  const folder = join(site.root, 'extensions'), code: [string, string][] = [];
  const visit = (path: string, prefix = '') => { for (const item of readdirSync(path, { withFileTypes: true })) {
    if (item.isDirectory()) visit(join(path, item.name), prefix + item.name + '/');
    else if (item.isFile() && (item.name.endsWith('.mjs') || item.name === 'manifest.json')) code.push([prefix + item.name, digest(readFileSync(join(path, item.name)).toString('base64'))]);
  } };
  if (existsSync(folder)) visit(folder);
  const content = target === 'published' ? site.store.state('release') ?? '' : ['entry', 'settings', 'type', 'layout', 'term', 'extension-config'].flatMap((scope) => site.store.list(scope).map((row) => [scope, row.id, row.revision]));
  return digest([content, code.sort(([a], [b]) => a.localeCompare(b)), site.store.list('extension-config').map((row) => [row.id, row.revision])]);
}
export async function auditRelease(release: Release, options: {
  target?: SeoAudit['target']; basis?: string;
  render?: (entry: Entry, release: Release) => Promise<string | null>;
  metadata?: (entry: Entry, release: Release, url: URL, options: { html: string }) => Promise<PageMetadata>;
  responses?: Record<string, { html?: string; status: number; error?: string }>;
  blocks?: Site['blockRenderers'];
} = {}): Promise<SeoAudit> {
  const entries = release.entries.filter((entry) => entry.visibility !== 'private'), publicRelease = { ...release, entries };
  const findings: SeoFinding[] = [], pages: SeoAudit['pages'] = [], hashes: string[] = [];
  const titles = new Map<string, Entry[]>(), descriptions = new Map<string, Entry[]>(), contents = new Map<string, Entry[]>();
  const incoming = new Set<string>(), paths = new Set(entries.map((entry) => entry.path));
  const add = (entry: Entry, rule: string, message: string, action: string, evidence = '', severity: SeoFinding['severity'] = 'warning') =>
    findings.push({ id: digest([entry.id, rule, evidence]).slice(0, 24), rule, severity, entryId: entry.id, path: entry.path, message, action, evidence });
  const group = (map: Map<string, Entry[]>, value: string, entry: Entry) => { if (value) map.set(value, [...(map.get(value) ?? []), entry]); };
  const base = release.settings.domain;
  const navigation = (items: typeof release.settings.navigation) => items.forEach((item) => {
    try { const path = item.url.startsWith('entry:') ? entries.find((entry) => entry.id === item.url.slice(6))?.path : item.url; if (path) { const url = new URL(path, base); if (url.origin === new URL(base).origin) incoming.add(url.pathname); } } catch {}
    navigation(item.children ?? []);
  }); navigation(release.settings.navigation);
  for (const entry of entries) {
    let html = '', available = true;
    try {
      if (options.responses) {
        const response = options.responses[entry.id];
        if (!response || response.error || response.status < 200 || response.status >= 300 || !response.html) {
          available = false;
          add(entry, 'unavailable', '页面未能取得，内容检查保持未知。', '检查响应状态后重新读取这个页面。', response?.error || String(response?.status ?? 'not-fetched'), 'info');
        } else html = response.html;
      } else {
        html = await options.render?.(entry, publicRelease) || '';
        const body = html || renderEntryTemplate(entry, publicRelease, options.blocks), url = new URL(entry.path, base);
        const metadata = options.metadata ? await options.metadata(entry, publicRelease, url, { html: body }) : pageMetadata(entry, publicRelease, url, { html: body });
        html = html ? composeMetadata(html, metadata) : `<html><head>${metadataHead(metadata)}</head><body><main>${body}</main></body></html>`;
      }
    } catch (error: any) { available = false; add(entry, 'render', '页面渲染未完成，检查保持未知。', '修复页面或扩展的渲染错误。', String(error.message), 'error'); }
    if (!available) { pages.push({ id: entry.id, path: entry.path, revision: entry.revisionId, status: 'unavailable' }); continue; }
    const $ = load(html), canonical = $('link[rel="canonical"]').attr('href') || '', robots = $('meta[name="robots"]').attr('content') || '';
    if ($('title').length > 1 || $('link[rel="canonical"]').length > 1) add(entry, 'duplicate-metadata', '页面有重复的标题或规范地址。', '让统一元信息服务负责输出，扩展通过 metadata 提供补充。');
    if (!$('script[type="application/ld+json"]').length) add(entry, 'json-ld-missing', '页面没有结构化数据。', '检查统一元信息是否进入最终页面。');
    const indexable = entry.indexable && !/noindex/i.test(robots);
    pages.push({ id: entry.id, path: entry.path, revision: entry.revisionId, status: 'checked', indexable, canonical });
    hashes.push(digest(html));
    const title = $('title').first().text().trim(), description = $('meta[name="description"]').attr('content')?.trim() || '';
    if (!title) add(entry, 'title', '页面没有标题。', '填写页面标题或 SEO 标题。');
    if (!description) add(entry, 'description', '页面没有摘要。', '为页面填写能概括实际内容的摘要。');
    if (!canonical) add(entry, 'canonical', '页面缺少规范地址。', '使用统一元信息输出规范地址。');
    else try {
      const target = new URL(canonical);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error();
      const hidden = release.entries.find((item) => item.path === target.pathname && item.visibility === 'private');
      if (target.origin === new URL(base).origin && hidden) add(entry, 'canonical-private', '规范地址指向私密内容。', '选择公开的规范页面。', canonical, 'error');
      if (indexable && target.href === new URL(entry.path, base).href) {
        group(titles, title, entry); group(descriptions, description, entry);
        group(contents, $('main').text().replace(/\s+/g, ' ').trim(), entry);
      }
    } catch { add(entry, 'canonical-invalid', '规范地址无效。', '填写完整的 HTTP 或 HTTPS 地址。', canonical, 'error'); }
    const h1 = $('h1').length;
    if (h1 !== 1) add(entry, 'heading', `页面有 ${h1} 个一级标题。`, '检查主标题是否清楚表达页面主题。', String(h1));
    const missingAlt = $('img').filter((_i, node) => $(node).attr('alt') === undefined).length;
    if (missingAlt) add(entry, 'image-alt', `${missingAlt} 张图片缺少说明属性。`, '有信息的图片填写说明，装饰图片保留空 alt。', String(missingAlt));
    $('script[type="application/ld+json"]').each((_i, node) => { try { JSON.parse($(node).html() || ''); } catch { add(entry, 'json-ld', '结构化数据不是有效 JSON。', '修复生成器或扩展输出。', '', 'error'); } });
    $('a[href]').each((_i, node) => {
      try {
        const url = new URL($(node).attr('href')!, new URL(entry.path, base));
        if (url.origin !== new URL(base).origin) return;
        const redirect = release.redirects?.[url.pathname];
        if (url.pathname !== entry.path) incoming.add(typeof redirect === 'string' ? redirect : redirect?.target ?? url.pathname);
        if (!paths.has(url.pathname) && !release.redirects?.[url.pathname] && !/^\/(admin|__preview|api|media|search|video)(\/|$)/.test(url.pathname) && !['/robots.txt', '/sitemap.xml', '/rss.xml'].includes(url.pathname))
          add(entry, 'internal-link', '站内链接没有对应公开页面。', '修正链接或发布目标内容。', url.pathname);
      } catch {}
    });
    for (const item of entry.evidence ?? []) if (!evidenceCurrent(item)) add(entry, 'evidence', item.status === 'verified' ? '来源已经到期，需要复核。' : '这项说法仍待核验。', '补齐来源和核验日期，核对内容后标为已核验。', item.id);
  }
  for (const [rule, map, label] of [['duplicate-title', titles, '标题'], ['duplicate-description', descriptions, '摘要'], ['duplicate-content', contents, '正文']] as const)
    for (const [value, group] of map) if (group.length > 1) for (const entry of group) add(entry, rule, `多个公开页面使用相同${label}。`, '确认是否重复；保留的不同页面应表达各自用途。', group.map((entry) => entry.path).join(', '));
  const extra = Object.entries(options.responses ?? {}).filter(([key]) => key.startsWith('url:'));
  let discovery = true;
  for (const [key, response] of extra) {
    if (response.error || !response.html || response.status < 200 || response.status >= 300) { discovery = false; continue; }
    const $ = load(response.html), source = new URL(key.slice(4));
    $('a[href]').each((_i, element) => { try { const url = new URL($(element).attr('href')!, source); if (url.origin === source.origin && url.pathname !== source.pathname) incoming.add(url.pathname); } catch {} });
  }
  if (!options.responses) discovery = !entries.some((entry) => { const blocks = JSON.stringify([entry.blocks, release.layouts]); return /"(content-list|cards)"/.test(blocks) || entry.template === 'newsletter-archive'; });
  const complete = pages.every((page) => page.status === 'checked') && discovery;
  if (complete) for (const entry of entries) if (entry.path !== '/' && entry.indexable && !incoming.has(entry.path)) add(entry, 'orphan', '未发现其它页面或导航指向这个页面。', '从相关页面或导航建立有意义的链接。');
  const basis = options.basis ?? digest(release), id = digest([basis, options.target, !!options.responses, pages, findings, hashes, new Date().toISOString().slice(0, 10), 1]);
  return { id, rulesVersion: 1, createdAt: new Date().toISOString(), releaseId: release.id, basis, target: options.target ?? 'published',
    coverage: { eligible: entries.length, checked: pages.filter((page) => page.status === 'checked').length, unavailable: pages.filter((page) => page.status === 'unavailable').length, excludedPrivate: release.entries.length - entries.length, source: options.responses ? 'http-response' : 'publication-render', paginationChecked: extra.filter(([, response]) => !response.error && !!response.html && response.status >= 200 && response.status < 300).length, linkDiscoveryComplete: complete }, pages,
    findings: [...new Map(findings.map((item) => [item.id, item])).values()] };
}
export function storeAudit(site: Site, report: SeoAudit) {
  const existing = site.store.get('seo-audit', report.id);
  return existing ?? site.store.put('seo-audit', report.id, report, null, '网站检查');
}
export function auditStatus(site: Site, report: SeoAudit) { return { ...report, stale: report.rulesVersion !== 1 || report.basis !== auditBasis(site, report.target) || report.createdAt.slice(0, 10) !== new Date().toISOString().slice(0, 10) }; }
