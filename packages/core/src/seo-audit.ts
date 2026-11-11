import type { Entry, Release } from '@weava/contracts';
import { load } from 'cheerio';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../../runtime-common/src/identity.ts';
import { renderEntryTemplate } from './render.ts';
import {
  composeMetadata,
  evidenceCurrent,
  metadataHead,
  pageMetadata,
  type PageMetadata,
} from './seo.ts';
import type { Site } from './site.ts';
import { entrySchema } from '@weava/contracts';
import type { AuditResponse, CrawlState } from './seo-crawl.ts';
import { structuredDataIssues } from './seo-structured-data.ts';
import { googleRobotRules, robotsBlocks } from './seo-robots.ts';
import { siteRoutes } from './site-routes.ts';
export async function fetchAuditResponses(
  release: Release,
  origin: string,
  maxPages = 200,
  fetcher: typeof fetch = fetch,
) {
  const responses: Record<string, { html?: string; status: number; error?: string }> = {};
  const entries = release.entries
    .filter((entry) => entry.visibility !== 'private')
    .slice(0, maxPages);
  const queue = entries.map((entry) => ({ key: entry.id, url: new URL(entry.path, origin).href })),
    seen = new Set(queue.map((item) => item.url));
  const paths = new Set(entries.map((entry) => entry.path));
  for (let offset = 0; offset < queue.length;) {
    const batch = queue.slice(offset, offset + 4);
    offset += batch.length;
    await Promise.all(
      batch.map(async (item) => {
        try {
          const response = await fetcher(item.url, {
            redirect: 'manual',
            headers: { 'User-Agent': 'Weava-Site-Audit/1' },
            signal: AbortSignal.timeout(8000),
          });
          const html = await response.text();
          responses[item.key] = {
            status: response.status,
            ...(html.length <= 2_000_000 ? { html } : { error: '响应超过 2 MB 检查预算。' }),
          };
          if (response.ok && html.length <= 2_000_000)
            load(html)('a[rel="next"],a[rel="prev"]').each((_i, element) => {
              const href = element.attribs.href;
              if (!href) return;
              const url = new URL(href, item.url);
              url.hash = '';
              if (
                url.origin !== new URL(origin).origin ||
                !paths.has(url.pathname) ||
                seen.has(url.href)
              )
                return;
              seen.add(url.href);
              const key = 'url:' + url.href;
              if (queue.length < maxPages) queue.push({ key, url: url.href });
              else responses[key] = { status: 0, error: '分页未读取：达到页面检查预算。' };
            });
        } catch {
          responses[item.key] = { status: 0, error: '读取失败或超时，请检查服务后重试。' };
        }
      }),
    );
  }
  return responses;
}

export interface SeoFinding {
  id: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  entryId: string;
  path: string;
  message: string;
  action: string;
  evidence: string;
  groupId?: string;
}
export interface SeoDuplicateGroup { id: string; rule: string; paths: string[] }
export interface SeoAudit {
  id: string;
  rulesVersion: 1 | 2 | 3;
  createdAt: string;
  releaseId: string;
  basis: string;
  target: 'draft' | 'published';
  coverage: {
    eligible: number;
    checked: number;
    unavailable: number;
    excludedPrivate: number;
    source: string;
    paginationChecked: number;
    linkDiscoveryComplete: boolean;
  };
  pages: {
    id: string;
    path: string;
    revision: number;
    status: 'checked' | 'unavailable';
    indexable?: boolean;
    canonical?: string;
    httpStatus?: number;
    facts?: { title: string; description: string; contentHash: string; links: string[] };
  }[];
  findings: SeoFinding[];
  duplicateGroups?: SeoDuplicateGroup[];
  crawl?: CrawlState;
}
export function auditBasis(site: Site, target: SeoAudit['target']) {
  const folder = join(site.root, 'extensions'),
    code: [string, string][] = [];
  const visit = (path: string, prefix = '') => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (item.isDirectory()) visit(join(path, item.name), prefix + item.name + '/');
      else if (item.isFile() && (item.name.endsWith('.mjs') || item.name === 'manifest.json'))
        code.push([
          prefix + item.name,
          digest(readFileSync(join(path, item.name)).toString('base64')),
        ]);
    }
  };
  if (existsSync(folder)) visit(folder);
  const content =
    target === 'published'
      ? (site.store.state('release') ?? '')
      : ['entry', 'settings', 'type', 'layout', 'term', 'extension-config'].flatMap((scope) =>
          (site.store.raw.prepare('SELECT id,revision FROM records WHERE scope=? ORDER BY id').all(scope) as {id:string;revision:number}[]).map((row) => [scope, row.id, row.revision]),
        );
  return digest([
    content,
    code.sort(([a], [b]) => a.localeCompare(b)),
    siteRoutes(site.root).build?.manifest ?? null,
    site.store.raw.prepare("SELECT id,revision FROM records WHERE scope='extension-config' ORDER BY id").all(),
  ]);
}
export async function auditRelease(
  release: Release,
  options: {
    target?: SeoAudit['target'];
    basis?: string;
    render?: (entry: Entry, release: Release) => Promise<string | null>;
    metadata?: (
      entry: Entry,
      release: Release,
      url: URL,
      options: { html: string },
    ) => Promise<PageMetadata>;
    responses?: Record<string, AuditResponse>;
    previous?: SeoAudit;
    crawl?: CrawlState;
    customPaths?: string[];
    blocks?: Site['blockRenderers'];
    progress?: (checked: number, total: number) => void;
  } = {},
): Promise<SeoAudit> {
  const entries = release.entries.filter((entry) => entry.visibility !== 'private'),
    publicRelease = { ...release, entries };
  const originalCount = entries.length;
  const additional = new Set([...(options.previous?.pages.filter(page => page.id.startsWith('url:')).map(page => page.id) ?? []),
    ...Object.keys(options.responses ?? {}).filter(key => key.startsWith('url:') && !/\/(?:robots\.txt|[^/?]*sitemap[^/?]*)(?:\?|$)/i.test(new URL(key.slice(4)).pathname))]);
  for (const key of additional) {
    const url = new URL(key.slice(4));
    const response = options.responses?.[key];
    if (response?.headers?.['content-type'] && !/html/i.test(response.headers['content-type'])) continue;
    entries.push({ ...entrySchema.parse({ id: key, kind: 'page', path: url.pathname + url.search, title: url.pathname }), revisionId: 0 } as any);
  }
  const findings: SeoFinding[] = [],
    duplicateGroups: SeoDuplicateGroup[] = [],
    pages: SeoAudit['pages'] = [],
    hashes: string[] = [];
  const titles = new Map<string, Entry[]>(),
    descriptions = new Map<string, Entry[]>(),
    contents = new Map<string, Entry[]>();
  const incoming = new Set<string>(),
    paths = new Set([...entries.map((entry) => new URL(entry.path, release.settings.domain).pathname), ...(options.customPaths ?? [])]);
  const add = (
    entry: Entry,
    rule: string,
    message: string,
    action: string,
    evidence = '',
    severity: SeoFinding['severity'] = 'warning',
    groupId?: string,
  ) =>
    findings.push({
      id: digest([entry.id, rule, evidence, groupId]).slice(0, 24),
      rule,
      severity,
      entryId: entry.id,
      path: entry.path,
      message,
      action,
      evidence,
      ...(groupId ? {groupId} : {}),
    });
  const group = (map: Map<string, Entry[]>, value: string, entry: Entry) => {
    if (!value) return;
    const items = map.get(value);
    if (items) items.push(entry);
    else map.set(value, [entry]);
  };
  const base = release.settings.domain;
  const navigation = (items: typeof release.settings.navigation) =>
    items.forEach((item) => {
      try {
        const path = item.url.startsWith('entry:')
          ? entries.find((entry) => entry.id === item.url.slice(6))?.path
          : item.url;
        if (path) {
          const url = new URL(path, base);
          if (url.origin === new URL(base).origin) incoming.add(url.pathname);
        }
      } catch {}
      navigation(item.children ?? []);
    });
  navigation(release.settings.navigation);
  for (const entry of entries) {
    const prior = options.previous?.pages.find(page => page.id === entry.id);
    if (prior && !options.responses?.[entry.id]) {
      pages.push(prior);
      findings.push(...(options.previous?.findings.filter(finding => finding.entryId === entry.id && !['duplicate-title', 'duplicate-description', 'duplicate-content', 'orphan', 'internal-link', 'sitemap-missing', 'robots-blocked', 'canonical-target', 'sitemap-policy', 'sitemap-unavailable', 'robots-unavailable'].includes(finding.rule)) ?? []));
      if (prior.facts) {
        for (const path of prior.facts.links) incoming.add(path);
        if (prior.indexable && prior.canonical === new URL(entry.path, base).href) {
          group(titles, prior.facts.title, entry); group(descriptions, prior.facts.description, entry); group(contents, prior.facts.contentHash, entry);
        }
      }
      continue;
    }
    if (pages.length % 50 === 0) options.progress?.(pages.length, entries.length);
    let html = '',
      available = true;
    try {
      if (options.responses) {
        const response = options.responses[entry.id];
        if (
          !response ||
          response.error ||
          response.status < 200 ||
          response.status >= 300 ||
          !response.html
        ) {
          available = false;
          add(
            entry,
            'unavailable',
            '页面未能取得，内容检查保持未知。',
            '检查响应状态后重新读取这个页面。',
            response?.error || String(response?.status ?? 'not-fetched'),
            'info',
          );
        } else html = response.html;
      } else {
        html = (await options.render?.(entry, publicRelease)) || '';
        const body = html || renderEntryTemplate(entry, publicRelease, options.blocks),
          url = new URL(entry.path, base);
        const metadata = options.metadata
          ? await options.metadata(entry, publicRelease, url, { html: body })
          : pageMetadata(entry, publicRelease, url, { html: body });
        html = html
          ? composeMetadata(html, metadata)
          : `<html><head>${metadataHead(metadata)}</head><body><main>${body}</main></body></html>`;
      }
    } catch (error: any) {
      available = false;
      add(
        entry,
        'render',
        '页面渲染未完成，检查保持未知。',
        '修复页面或扩展的渲染错误。',
        String(error.message),
        'error',
      );
    }
    if (!available) {
      pages.push({
        id: entry.id,
        path: entry.path,
        revision: entry.revisionId,
        status: 'unavailable',
        httpStatus: options.responses?.[entry.id]?.status,
      });
      continue;
    }
    const $ = load(html),
      canonical = $('link[rel="canonical"]').attr('href') || '',
      robots = [ $('meta[name="robots"]').attr('content') || '', $('meta[name="googlebot"]').attr('content') || '', googleRobotRules(options.responses?.[entry.id]?.headers?.['x-robots-tag']) ].join(',');
    if ($('title').length > 1 || $('link[rel="canonical"]').length > 1)
      add(
        entry,
        'duplicate-metadata',
        '页面有重复的标题或规范地址。',
        '让统一元信息服务负责输出，扩展通过 metadata 提供补充。',
      );
    if (!$('script[type="application/ld+json"]').length)
      add(entry, 'json-ld-missing', '页面没有结构化数据。', '检查统一元信息是否进入最终页面。');
    const indexable = entry.indexable && !/(?:noindex|\bnone\b)/i.test(robots);
    pages.push({
      id: entry.id,
      path: entry.path,
      revision: entry.revisionId,
      status: 'checked',
      indexable,
      canonical,
      httpStatus: options.responses?.[entry.id]?.status,
      facts: { title: $('title').first().text().trim(), description: $('meta[name="description"]').attr('content')?.trim() || '',
        contentHash: $('main').text().trim() ? digest($('main').text().replace(/\s+/g, ' ').trim()) : '', links: [] },
    });
    hashes.push(digest(html));
    const title = $('title').first().text().trim(),
      description = $('meta[name="description"]').attr('content')?.trim() || '';
    if (!title) add(entry, 'title', '页面没有标题。', '填写页面标题或 SEO 标题。');
    if (!description)
      add(entry, 'description', '页面没有摘要。', '为页面填写能概括实际内容的摘要。');
    if (!canonical) add(entry, 'canonical', '页面缺少规范地址。', '使用统一元信息输出规范地址。');
    else
      try {
        const target = new URL(canonical);
        if (!['http:', 'https:'].includes(target.protocol)) throw new Error();
        const hidden = release.entries.find(
          (item) => item.visibility === 'private' && new URL(item.path, base).pathname === target.pathname,
        );
        if (target.origin === new URL(base).origin && hidden)
          add(
            entry,
            'canonical-private',
            '规范地址指向私密内容。',
            '选择公开的规范页面。',
            canonical,
            'error',
          );
        if (indexable && target.href === new URL(entry.path, base).href) {
          group(titles, title, entry);
          group(descriptions, description, entry);
          group(contents, pages.at(-1)!.facts!.contentHash, entry);
        }
      } catch {
        add(
          entry,
          'canonical-invalid',
          '规范地址无效。',
          '填写完整的 HTTP 或 HTTPS 地址。',
          canonical,
          'error',
        );
      }
    const h1 = $('h1').length;
    if (h1 !== 1)
      add(
        entry,
        'heading',
        `页面有 ${h1} 个一级标题。`,
        '检查主标题是否清楚表达页面主题。',
        String(h1),
      );
    const missingAlt = $('img').filter((_i, node) => $(node).attr('alt') === undefined).length;
    if (missingAlt)
      add(
        entry,
        'image-alt',
        `${missingAlt} 张图片缺少说明属性。`,
        '有信息的图片填写说明，装饰图片保留空 alt。',
        String(missingAlt),
      );
    $('script[type="application/ld+json"]').each((_i, node) => {
      try {
        JSON.parse($(node).html() || '');
      } catch {
        add(entry, 'json-ld', '结构化数据不是有效 JSON。', '修复生成器或扩展输出。', '', 'error');
      }
    });
    for (const issue of structuredDataIssues(html)) add(entry, issue.rule, issue.message, '核对结构化数据与页面实际内容；缺少的真实信息需要补充，不能编造。', issue.evidence);
    $('a[href]').each((_i, node) => {
      try {
        const url = new URL($(node).attr('href')!, new URL(entry.path, base));
        if (url.origin !== new URL(base).origin) return;
        pages.at(-1)!.facts!.links.push(url.pathname);
        const redirect = release.redirects?.[url.pathname];
        const linkedPath = typeof redirect === 'string' ? redirect : (redirect?.target ?? url.pathname);
        const destination = new URL(linkedPath, base).pathname;
        if (destination !== new URL(entry.path, base).pathname) incoming.add(destination);
        if (!options.crawl &&
          !paths.has(url.pathname) &&
          !release.redirects?.[url.pathname] &&
          !/^\/(admin|__preview|api|media|search|video)(\/|$)/.test(url.pathname) &&
          !['/robots.txt', '/sitemap.xml', '/rss.xml'].includes(url.pathname)
        )
          add(
            entry,
            'internal-link',
            '站内链接没有对应公开页面。',
            '修正链接或发布目标内容。',
            url.pathname,
          );
      } catch {}
    });
    for (const item of entry.evidence ?? [])
      if (!evidenceCurrent(item))
        add(
          entry,
          'evidence',
          item.status === 'verified' ? '来源已经到期，需要复核。' : '这项说法仍待核验。',
          '补齐来源和核验日期，核对内容后标为已核验。',
          item.id,
        );
  }
  if (options.crawl?.complete) for (const page of pages) for (const path of new Set(page.facts?.links ?? [])) {
    if (paths.has(path) || release.redirects?.[path] || /^\/(admin|__preview|api|media|search|video)(\/|$)/.test(path) || ['/robots.txt', '/sitemap.xml', '/rss.xml'].includes(path)) continue;
    const entry = entries.find(entry => entry.id === page.id)!;
    add(entry, 'internal-link', '站内链接没有对应公开页面。', '修正链接或发布目标内容。', path);
  }
  if (options.crawl) {
    const documents = options.crawl.documents, maps = Object.values(documents?.sitemaps ?? {});
    const sitemapUrls = new Set(maps.filter(map => !map.index && map.status === 200).flatMap(map => map.urls));
    const mapComplete = options.crawl.complete && maps.length > 0 && maps.every(map => map.status === 200);
    const reference = entries[0];
    if (reference && (!documents?.robots || documents.robots.status >= 500)) add(reference, 'robots-unavailable', 'robots.txt 未能读取，抓取策略保持未知。', '检查公开 robots.txt 的实际响应。', '', 'info');
    if (reference && !mapComplete) add(reference, 'sitemap-unavailable', '站点地图尚未完整取得。', '继续检查未读取的地图，或修复其响应状态。', '', 'info');
    for (const page of pages.filter(page => page.status === 'checked')) {
      const entry = entries.find(entry => entry.id === page.id)!;
      if (page.indexable && documents?.robots?.status === 200 && robotsBlocks(documents.robots.text, page.path)) add(entry, 'robots-blocked', '页面允许索引，但 robots.txt 阻止抓取。', '核对页面与 robots.txt 的策略。', page.path);
      if (page.canonical && URL.canParse(page.canonical) && new URL(page.canonical).origin === new URL(base).origin) {
        const target = pages.find(target => new URL(target.path, base).href === page.canonical);
        if (target?.httpStatus && (target.httpStatus < 200 || target.httpStatus >= 300)) add(entry, 'canonical-target', '规范网址未直接返回成功页面。', '修正规范网址或目标页面。', `${page.canonical} HTTP ${target.httpStatus}`);
      }
      const own = new URL(page.path, base).href;
      if (mapComplete && page.indexable && page.canonical === own && !page.id.startsWith('url:') && !sitemapUrls.has(own)) add(entry, 'sitemap-missing', '可索引的首选页面未进入站点地图。', '核对地图生成与页面元信息是否一致。', own);
      if (sitemapUrls.has(own) && (!page.indexable || page.canonical !== own)) add(entry, 'sitemap-policy', '地图收录了不应索引或声明其它首选网址的页面。', '按最终页面索引策略重新生成地图。', own);
    }
  }
  for (const [rule, map, label] of [
    ['duplicate-title', titles, '标题'],
    ['duplicate-description', descriptions, '摘要'],
    ['duplicate-content', contents, '正文'],
  ] as const)
    for (const group of map.values())
      if (group.length > 1) {
        const paths = group.map(entry => entry.path), groupId = digest([rule, paths]).slice(0, 24);
        duplicateGroups.push({id:groupId, rule, paths});
        for (const entry of group)
          add(
            entry,
            rule,
            `多个公开页面使用相同${label}。`,
            '确认是否重复；保留的不同页面应表达各自用途。',
            `共 ${group.length} 个页面`,
            'warning',
            groupId,
          );
      }
  const extra = Object.entries(options.responses ?? {}).filter(([key]) => key.startsWith('url:') && additional.has(key));
  let discovery = true;
  for (const [key, response] of extra) {
    if (response.error || !response.html || response.status < 200 || response.status >= 300) {
      discovery = false;
      continue;
    }
    const $ = load(response.html),
      source = new URL(key.slice(4));
    $('a[href]').each((_i, element) => {
      try {
        const url = new URL($(element).attr('href')!, source);
        if (url.origin === source.origin && url.pathname !== source.pathname)
          incoming.add(url.pathname);
      } catch {}
    });
  }
  if (!options.responses)
    discovery = !entries.some((entry) => {
      const blocks = JSON.stringify([entry.blocks, release.layouts]);
      return /"(content-list|cards)"/.test(blocks) || entry.template === 'newsletter-archive';
    });
  const complete = pages.every((page) => page.status === 'checked') && discovery && (options.crawl?.complete ?? true);
  if (complete)
    for (const entry of entries)
      if (!entry.id.startsWith('url:') && entry.path !== '/' && entry.indexable && !incoming.has(new URL(entry.path, base).pathname))
        add(
          entry,
          'orphan',
          '未发现其它页面或导航指向这个页面。',
          '从相关页面或导航建立有意义的链接。',
        );
  const basis = options.basis ?? digest(release),
    id = digest([
      basis,
      options.target,
      !!options.responses,
      pages,
      findings,
      duplicateGroups,
      hashes,
      options.crawl,
      new Date().toISOString().slice(0, 10),
      3,
    ]);
  return {
    id,
    rulesVersion: 3,
    createdAt: new Date().toISOString(),
    releaseId: release.id,
    basis,
    target: options.target ?? 'published',
    coverage: {
      eligible: entries.length,
      checked: pages.filter((page) => page.status === 'checked').length,
      unavailable: pages.filter((page) => page.status === 'unavailable').length,
      excludedPrivate: release.entries.length - originalCount,
      source: options.responses ? 'http-response' : 'publication-render',
      paginationChecked: options.crawl ? pages.filter(page => page.id.startsWith('url:') && page.status === 'checked' && (/\/page\/[1-9]\d*\/$/.test(new URL(page.path, base).pathname) || new URL(page.path, base).searchParams.has('page'))).length : extra.filter(
        ([, response]) =>
          !response.error && !!response.html && response.status >= 200 && response.status < 300,
      ).length,
      linkDiscoveryComplete: complete,
    },
    pages,
    findings: [...new Map(findings.map((item) => [item.id, item])).values()],
    duplicateGroups,
    ...(options.crawl ? { crawl: options.crawl } : {}),
  };
}
export function storeAudit(site: Site, report: SeoAudit) {
  const existing = site.store.get('seo-audit', report.id);
  return existing ?? site.store.put('seo-audit', report.id, report, null, '网站检查');
}
/** Read old reports without repeating the same full path list in every finding. */
export function compactAudit(report: SeoAudit): SeoAudit {
  if (report.rulesVersion !== 1 || report.duplicateGroups) return report;
  const groups = new Map<string, SeoDuplicateGroup>();
  const findings = report.findings.map(finding => {
    if (!['duplicate-title', 'duplicate-description', 'duplicate-content'].includes(finding.rule)) return finding;
    const key = finding.rule + '\0' + finding.evidence;
    let group = groups.get(key);
    if (!group) { group = {id:digest(key).slice(0,24), rule:finding.rule, paths:[]}; groups.set(key, group); }
    group.paths.push(finding.path);
    return {...finding, evidence:'', groupId:group.id};
  });
  return {...report, findings, duplicateGroups:[...groups.values()]};
}
export function auditStatus(site: Site, report: SeoAudit, basis = auditBasis(site, report.target)) {
  return {
    ...compactAudit(report),
    stale:
      report.rulesVersion !== 3 ||
      report.basis !== basis ||
      report.createdAt.slice(0, 10) !== new Date().toISOString().slice(0, 10),
  };
}

export function seoAudits(site: Site) {
  const bases = new Map<SeoAudit['target'], string>();
  return site.store
    .list('seo-audit')
    .map((row) => {
      const report = row.value as SeoAudit;
      if (!bases.has(report.target)) bases.set(report.target, auditBasis(site, report.target));
      return auditStatus(site, report, bases.get(report.target)!);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
