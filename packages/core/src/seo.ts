import { load } from 'cheerio';
import { WeavaError, schemaTypes, type Entry, type Release, type Seo } from '@weava/contracts';
import { escape as e } from './documents.ts';
import { layoutFor } from './layouts.ts';

export interface PageMetadata {
  title: string; socialTitle: string; description: string; canonical: string; robots: string;
  image: string; imageAlt: string; ogType: string; language: string; siteName: string;
  schema: Record<string, any>; indexable: boolean; pagination: Record<string, number>;
}
export type MetadataContribution = Partial<Seo> & { schema?: Record<string, any>[] };
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function webUrl(value: string, base: string) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new WeavaError('网址需要使用 HTTP 或 HTTPS。');
  return url.href;
}
export function evidenceCurrent(item: NonNullable<Entry['evidence']>[number], at = new Date().toISOString()) {
  return item.status === 'verified' && !!item.url && !!item.verifiedAt && validDate(item.verifiedAt) && item.verifiedAt <= at.slice(0, 10) &&
    (!item.validUntil || Date.parse(item.validUntil + 'T23:59:59.999Z') >= Date.parse(at));
}
export function validateSeo(entry: Entry, domain: string) {
  for (const value of [entry.seo?.canonical, entry.seo?.image, entry.seo?.authorUrl]) if (value) webUrl(value, domain);
  const ids = new Set<string>();
  for (const item of entry.evidence ?? []) {
    if (ids.has(item.id)) throw new WeavaError('来源编号重复：' + item.id);
    ids.add(item.id);
    if (item.url) webUrl(item.url, domain);
    for (const date of [item.verifiedAt, item.validUntil]) if (date && !validDate(date)) throw new WeavaError('核验和到期日期需要是有效的 YYYY-MM-DD 日期。');
    if (item.verifiedAt && item.validUntil && item.validUntil < item.verifiedAt) throw new WeavaError('来源到期日期不能早于核验日期。');
    if (item.status === 'verified' && (!item.claim.trim() || !item.url || !item.verifiedAt)) throw new WeavaError('已核验来源需要说法、网址与核验日期。');
    if (item.status === 'verified' && item.verifiedAt! > new Date().toISOString().slice(0, 10)) throw new WeavaError('已核验来源不能使用未来的核验日期。');
  }
}
export function renderEvidence(entry: Entry) {
  if (!entry.evidence?.length) return '';
  return `<section class="prose entry-evidence" data-weava-evidence aria-label="来源与核验"><h2>来源与核验</h2><dl>${entry.evidence.map((item) =>
    `<div id="evidence-${e(item.id)}"><dt>${e(item.claim)}</dt><dd>${item.url ? `<a href="${e(item.url)}">${e(item.title || item.url)}</a>` : e(item.title || '来源待补充')} · ${e(evidenceCurrent(item) ? '已核验' : item.status === 'verified' ? '需要复核' : '待核验')}${item.verifiedAt ? ` · 核验 ${e(item.verifiedAt)}` : ''}${item.validUntil ? ` · 有效至 ${e(item.validUntil)}` : ''}</dd></div>`).join('')}</dl></section>`;
}
export function customEvidence(html: string, entry: Entry) {
  if (!entry.evidence?.length) return html;
  const $ = load(html); $('[data-weava-evidence]').remove();
  ($('main').length ? $('main').first() : $('body')).append(renderEvidence(entry));
  return $.html();
}
export function pageMetadata(entry: Entry | undefined, release: Release, url: URL, options: { preview?: boolean; missing?: boolean; html?: string; contribution?: MetadataContribution } = {}): PageMetadata {
  const settings = release.settings, base = settings.domain.replace(/\/$/, ''), seo = { ...options.contribution, ...entry?.seo };
  const socialTitle = seo.title || entry?.title || (options.missing ? '页面未找到' : '搜索');
  const description = seo.description ?? entry?.description ?? settings.description;
  const pageKeys = new Set<string>(), visitedLayouts = new Set<string>();
  const visit = (blocks: Entry['blocks']) => blocks.forEach((block) => {
    if (['cards', 'content-list'].includes(block.type)) pageKeys.add(String(block.props.pageKey || 'page'));
    if (block.type === 'shared' && !visitedLayouts.has(String(block.props.layoutId))) { visitedLayouts.add(String(block.props.layoutId)); visit(release.layouts?.find((layout) => layout.id === block.props.layoutId)?.blocks ?? []); }
    visit(block.children ?? []);
  });
  visit(entry?.blocks ?? []);
  if (entry) { const template = layoutFor(entry, release); visit(template.blocks); if (settings.theme === 'newsletter' && template.id === 'newsletter-archive') pageKeys.add('page'); }
  for (const id of Object.values(settings.regions ?? {})) visit(release.layouts?.find((layout) => layout.id === id)?.blocks ?? []);
  const canonicalUrl = new URL(webUrl(seo.canonical || entry?.path || url.pathname, base));
  const pagination: Record<string, number> = {};
  let filtered = url.pathname === '/search/';
  for (const [key, value] of url.searchParams) {
    if (pageKeys.has(key)) {
      const page = /^\d+$/.test(value) && url.searchParams.getAll(key).length === 1 ? Number(value) : NaN;
      if (Number.isSafeInteger(page) && page > 1) { canonicalUrl.searchParams.set(key, String(page)); pagination[key] = page; }
      else if (page !== 1) filtered = true;
    } else if (!/^(utm_|gclid$|fbclid$|msclkid$)/i.test(key)) filtered = true;
  }
  canonicalUrl.hash = '';
  canonicalUrl.searchParams.sort();
  const canonical = canonicalUrl.href;
  const hidden = options.preview || entry?.visibility === 'private';
  const indexable = !hidden && !options.missing && !!entry && entry.indexable !== false && !filtered;
  const robots = hidden ? 'noindex,nofollow' : indexable ? 'index,follow' : 'noindex,follow';
  const image = seo.image || entry?.cover || settings.seo?.image || '';
  const imageUrl = image ? webUrl(image, base) : '';
  const type = seo.schemaType || release.types.find((type) => type.id === entry?.type)?.schemaType || (entry?.kind === 'content' && entry.type === 'post' ? 'Article' : 'WebPage');
  const article = ['Article', 'TechArticle'].includes(type);
  const graph: Record<string, any>[] = [{ '@type': 'WebSite', '@id': base + '/#website', name: settings.name, url: base + '/', inLanguage: settings.language }];
  const publisher = settings.seo?.publisherType ? { '@type': settings.seo.publisherType, '@id': base + '/#publisher', name: settings.seo.publisherName || settings.name,
    url: webUrl(settings.seo.publisherUrl || '/', base), ...(settings.logo ? { image: webUrl(settings.logo, base) } : {}), ...(settings.seo.sameAs?.length ? { sameAs: settings.seo.sameAs.map((value) => webUrl(value, base)) } : {}) } : undefined;
  if (publisher) graph.push(publisher);
  const main: Record<string, any> = { '@type': type, '@id': canonical + '#content', name: socialTitle, url: canonical, description, inLanguage: settings.language,
    isPartOf: { '@id': base + '/#website' }, ...(imageUrl ? { image: imageUrl } : {}), ...(publisher ? { publisher: { '@id': publisher['@id'] } } : {}) };
  if (article) Object.assign(main, { headline: socialTitle, datePublished: entry?.publishedAt, dateModified: (entry as any)?.modifiedAt ?? entry?.updatedAt,
    ...(entry?.author ? { author: { '@type': seo.authorType || 'Person', name: entry.author, ...(seo.authorUrl ? { url: webUrl(seo.authorUrl, base) } : {}) } } : publisher ? { author: { '@id': publisher['@id'] } } : {}) });
  const citations = entry?.evidence?.filter((item) => evidenceCurrent(item)).map((item) => ({ '@type': 'CreativeWork', name: item.title || item.claim, url: webUrl(item.url, base), dateModified: item.verifiedAt }));
  if (citations?.length) main.citation = citations;
  graph.push(main);
  for (const node of options.contribution?.schema ?? []) {
    if (!node || typeof node !== 'object' || !node['@type']) continue;
    const existing = graph.findIndex((item) => node['@id'] ? item['@id'] === node['@id'] : item['@type'] === node['@type'] && item.url === node.url);
    if (existing < 0) graph.push(node); else graph[existing] = { ...node, ...graph[existing] };
  }
  if (options.html) {
    const $ = load(options.html), questions: Record<string, any>[] = [];
    $('[data-weava-faq] details').each((_index, element) => {
      const question = $(element).children('summary').first().text().trim(), answer = $(element).children('div').text().trim();
      if (question && answer) questions.push({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } });
    });
    if (questions.length) graph.push({ '@type': 'FAQPage', '@id': canonical + '#faq', mainEntity: questions });
  }
  return { title: socialTitle === settings.name ? socialTitle : `${socialTitle} · ${settings.name}`, socialTitle, description, canonical, robots,
    image: imageUrl, imageAlt: seo.imageAlt || '', ogType: article ? 'article' : 'website', language: settings.language, siteName: settings.name,
    schema: { '@context': 'https://schema.org', '@graph': graph }, indexable, pagination };
}
/** Apply the same metadata contract to full-document extension renders. */
export function composeMetadata(html: string, meta: PageMetadata, options: { preview?: boolean; track?: boolean; releaseId?: string } = {}) {
  const $ = load(html);
  $('head title, head meta[name="description"], head meta[name="robots"], head link[rel="canonical"], head meta[property^="og:"], head meta[name^="twitter:"], script[data-weava-seo]').remove();
  // Legacy JSON-LD remains available as extra properties, while identity and indexing stay authoritative.
  const graph = [...meta.schema['@graph']];
  $('script[type="application/ld+json"]').each((_i, element) => {
    try {
      const value = JSON.parse($(element).html() || ''), nodes = Array.isArray(value) ? value : value['@graph'] ?? [value];
      for (const node of nodes) {
        if (!node || !node['@type']) continue;
        const primary = schemaTypes.includes(node['@type']) && (!node.url || node.url === meta.canonical);
        const index = primary ? graph.findIndex((item) => item['@id'] === meta.canonical + '#content') : graph.findIndex((item) => node['@id'] ? item['@id'] === node['@id'] : item['@type'] === node['@type'] && (!node.url || item.url === node.url));
        const extra = { ...node };
        if (primary) for (const key of ['headline', 'name', 'url', 'datePublished', 'dateModified', 'author', 'citation', 'publisher']) delete extra[key];
        if (index < 0) graph.push(extra); else graph[index] = { ...extra, ...graph[index] };
      }
      $(element).remove();
    } catch { /* Keep malformed extension JSON-LD visible to the audit. */ }
  });
  $('head').append(metadataHead({ ...meta, schema: { ...meta.schema, '@graph': graph } }));
  if (options.preview) $('script').not('[type="application/ld+json"]').remove();
  $('body').attr('data-track', options.track ? 'true' : 'false');
  if (options.releaseId) $('body').attr('data-release', options.releaseId);
  if (options.track && !$('script[src="/weava-analytics.js"]').length) $('body').append('<script src="/weava-analytics.js" defer></script>');
  if (!options.preview && $('[data-copy-code]').length && !$('script[src="/weava-code.js"]').length) $('body').append('<script src="/weava-code.js" defer></script>');
  return $.html();
}
export function metadataHead(meta: PageMetadata) {
  return `<title>${e(meta.title)}</title><meta name="description" content="${e(meta.description)}"><meta name="robots" content="${meta.robots}"><link rel="canonical" href="${e(meta.canonical)}"><meta property="og:title" content="${e(meta.socialTitle)}"><meta property="og:description" content="${e(meta.description)}"><meta property="og:url" content="${e(meta.canonical)}"><meta property="og:type" content="${meta.ogType}"><meta property="og:site_name" content="${e(meta.siteName)}"><meta property="og:locale" content="${e(meta.language.replace('-', '_'))}"><meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">${meta.image ? `<meta property="og:image" content="${e(meta.image)}"><meta property="og:image:alt" content="${e(meta.imageAlt)}"><meta name="twitter:image" content="${e(meta.image)}">` : ''}<script type="application/ld+json" data-weava-seo>${JSON.stringify(meta.schema).replaceAll('<', '\\u003c')}</script>`;
}
