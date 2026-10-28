import sax from 'sax';
import { load } from 'cheerio';
import { basename, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { entrySchema, WeavaError, type Entry, type Block, type Term, type ContentType } from '@weava/contracts';
import type { Site } from './site.ts';
import { normalizePath } from './site.ts';
import { digest, inside } from './storage.ts';
import { plain, sanitize } from './documents.ts';
import { importSite, type ImportOptions, type SiteExchange } from './exchange.ts';
import { prepareMedia } from './media.ts';

interface Xml { name: string; text: string; attrs: Record<string, string>; children: Xml[] }
function parseXml(source: string) {
  if (Buffer.byteLength(source) > 128 * 1024 * 1024) throw new WeavaError('WXR 文件超过 128 MB，请在 WordPress 分批导出。');
  const root: Xml = { name: '#document', text: '', attrs: {}, children: [] }, stack = [root];
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  parser.onopentag = (tag) => {
    const prefix = /wordpress\.org\/export\/1\.[012]\/?$/.test(tag.uri) ? 'wp:' : tag.uri === 'http://purl.org/rss/1.0/modules/content/' ? 'content:' : tag.uri === 'http://wordpress.org/export/1.2/excerpt/' || /wordpress\.org\/export\/1\.[012]\/excerpt\//.test(tag.uri) ? 'excerpt:' : tag.uri === 'http://purl.org/dc/elements/1.1/' ? 'dc:' : '';
    const node: Xml = { name: prefix + tag.local, text: '', children: [], attrs: Object.fromEntries(Object.values(tag.attributes).map((attr) => [attr.local, attr.value])) };
    stack.at(-1)!.children.push(node); stack.push(node);
  };
  parser.onclosetag = () => { stack.pop(); };
  parser.ontext = parser.oncdata = (text) => { stack.at(-1)!.text += text; };
  parser.ondoctype = () => { throw new WeavaError('WXR 不需要 DTD，请使用 WordPress 的标准导出文件。'); };
  parser.onerror = (error) => { throw new WeavaError('WXR XML 不完整或格式无效：' + error.message); };
  parser.write(source.replace(/^\ufeff/, '')).close();
  const rss = root.children.find((node) => node.name === 'rss'), channel = rss?.children.find((node) => node.name === 'channel');
  if (!channel || !['1.0', '1.1', '1.2'].includes(text(channel, 'wp:wxr_version'))) throw new WeavaError('这不是受支持的 WordPress WXR 导出文件。');
  return channel;
}
const children = (node: Xml, name: string) => node.children.filter((child) => child.name === name);
const text = (node: Xml, name: string) => children(node, name)[0]?.text ?? '';
const titleText = (value: string) => plain(value).trim();
interface Item {
  id: string; type: string; title: string; url: string; slug: string; parent: string; status: string;
  body: string; excerpt: string; creator: string; date?: string; modified?: string; password: boolean;
  media: string; meta: Record<string, string[]>; taxonomies: { kind: string; slug: string; label: string }[]; comments: Xml[];
}
interface Conversion { id: string; title: string; native: string[]; compatible: string[]; unresolved: string[] }
interface WpBlock { name: string; attrs: Record<string, any>; html: string; children: WpBlock[] }
function parseBlocks(body: string): WpBlock[] {
  const roots: WpBlock[] = [], stack: { block: WpBlock; start: number }[] = [];
  let cursor = 0;
  for (const match of body.matchAll(/<!--\s*(\/)?wp:([\w/-]+)(?:\s+(\{[\s\S]*?\}))?\s*(\/)?-->/g)) {
    if (!stack.length && match.index! > cursor && body.slice(cursor, match.index).trim()) roots.push({ name: 'core/freeform', attrs: {}, html: body.slice(cursor, match.index), children: [] });
    if (match[1]) {
      const current = stack.pop();
      const name = match[2].includes('/') ? match[2] : 'core/' + match[2];
      if (!current || current.block.name !== name) throw new WeavaError('WordPress 区块的开始与结束标记不匹配。');
      current.block.html = body.slice(current.start, match.index);
    } else {
      let attrs: any = {}; try { attrs = match[3] ? JSON.parse(match[3]) : {}; } catch { throw new WeavaError('WordPress 区块属性不是有效 JSON。'); }
      const block: WpBlock = { name: match[2].includes('/') ? match[2] : 'core/' + match[2], attrs, html: '', children: [] };
      (stack.at(-1)?.block.children ?? roots).push(block);
      if (!match[4]) stack.push({ block, start: match.index! + match[0].length });
    }
    cursor = match.index! + match[0].length;
  }
  if (stack.length) throw new WeavaError('WordPress 区块标记没有完整结束。');
  if (body.slice(cursor).trim()) roots.push({ name: 'core/freeform', attrs: {}, html: body.slice(cursor), children: [] });
  return roots;
}
export interface WxrOptions extends ImportOptions {
  settings?: boolean; downloadMedia?: boolean; mediaDirectory?: string; comments?: boolean;
  review?: { fingerprint: string; revision: number; releaseId: string | null; options: string };
}
const revision = (site: Site) => (site.store.raw.prepare('SELECT COALESCE(MAX(revision),0) n FROM revisions').get() as any).n as number;
const optionKey = (options: WxrOptions) => digest({ settings: !!options.settings, downloadMedia: !!options.downloadMedia, mediaDirectory: options.mediaDirectory ?? null, comments: options.comments !== false, mode: options.mode ?? 'create', revisions: options.revisions ?? {} });
export function convertWordPressWxr(site: Site, xml: string, options: WxrOptions = {}, mediaMap: Record<string, string> = {}) {
  const known = site.store.get('import-report', digest(xml))?.value;
  mediaMap = { ...Object.fromEntries((known?.attachments ?? []).filter((asset: any) => asset.local).flatMap((asset: any) => [[asset.url, asset.local], [new URL(asset.url).pathname, asset.local]])), ...mediaMap };
  const channel = parseXml(xml), sourceUrl = text(channel, 'wp:base_blog_url') || text(channel, 'link');
  let origin: URL; try { origin = new URL(sourceUrl); if (!['https:', 'http:'].includes(origin.protocol)) throw new Error(); } catch { throw new WeavaError('WordPress 来源站点网址无效。'); }
  const namespace = digest(origin.href.replace(/\/$/, '')).slice(0, 12), entryId = (id: string) => 'wordpress:' + namespace + ':' + id;
  const warnings: string[] = [], skipped: { id: string; type: string; reason: string }[] = [], conversions: Conversion[] = [];
  const authors = new Map(children(channel, 'wp:author').map((node) => [text(node, 'wp:author_login'), text(node, 'wp:author_display_name')]));
  const date = (gmt: string, fallback = '') => {
    const value = gmt && !gmt.startsWith('0000-') ? gmt.replace(' ', 'T') + 'Z' : fallback;
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  };
  const items: Item[] = children(channel, 'item').map((node) => {
    const meta: Record<string, string[]> = {};
    for (const item of children(node, 'wp:postmeta')) (meta[text(item, 'wp:meta_key')] ??= []).push(text(item, 'wp:meta_value'));
    return { id: text(node, 'wp:post_id'), type: text(node, 'wp:post_type') || 'post', title: titleText(text(node, 'title')), url: text(node, 'link'), slug: text(node, 'wp:post_name'),
      parent: text(node, 'wp:post_parent'), status: text(node, 'wp:status'), body: text(node, 'content:encoded'), excerpt: text(node, 'excerpt:encoded'), creator: text(node, 'dc:creator'),
      date: date(text(node, 'wp:post_date_gmt'), text(node, 'pubDate')), modified: date(text(node, 'wp:post_modified_gmt')), password: !!text(node, 'wp:post_password'),
      media: text(node, 'wp:attachment_url'), meta, taxonomies: children(node, 'category').map((term) => ({ kind: term.attrs.domain ?? '', slug: term.attrs.nicename ?? '', label: titleText(term.text) })), comments: children(node, 'wp:comment') };
  });
  const seen = new Set<string>();
  for (const item of items) { if (!/^\d+$/.test(item.id) || seen.has(item.id)) throw new WeavaError('WordPress 内容编号缺失或重复：' + item.id); seen.add(item.id); }
  const systemTypes = new Set(['attachment', 'revision', 'nav_menu_item', 'wp_navigation', 'wp_template', 'wp_template_part', 'wp_block', 'custom_css', 'customize_changeset', 'wp_global_styles', 'wp_font_family', 'wp_font_face']);
  const content = items.filter((item) => {
    const reason = systemTypes.has(item.type) ? '来源系统对象，保存在原始 WXR 资料中' : item.status === 'auto-draft' && !item.body.trim() ? '空自动草稿' : '';
    if (reason) skipped.push({ id: item.id, type: item.type, reason }); return !reason;
  });
  const termMap = new Map<string, Term>(), parentSlugs = new Map<string, string>();
  for (const [name, kind, slugKey, labelKey, parentKey] of [
    ['wp:category', 'category', 'wp:category_nicename', 'wp:cat_name', 'wp:category_parent'],
    ['wp:tag', 'tag', 'wp:tag_slug', 'wp:tag_name', ''],
  ] as const) for (const node of children(channel, name)) {
    const slug = text(node, slugKey), key = kind + ':' + slug;
    if (!slug || termMap.has(key)) throw new WeavaError('WXR 分类网址缺失或重复：' + key);
    termMap.set(key, { id: 'wpterm:' + namespace + ':' + kind + ':' + (text(node, 'wp:term_id') || digest(slug).slice(0, 12)), kind, label: titleText(text(node, labelKey)) || slug, slug });
    if (parentKey && text(node, parentKey)) parentSlugs.set(key, text(node, parentKey));
  }
  for (const item of content) for (const tax of item.taxonomies) {
    const kind = tax.kind === 'post_tag' ? 'tag' : tax.kind;
    if (!['category', 'tag'].includes(kind)) continue;
    const key = kind + ':' + tax.slug;
    if (!termMap.has(key)) termMap.set(key, { id: 'wpterm:' + namespace + ':' + digest(key).slice(0, 12), kind: kind as Term['kind'], label: tax.label || tax.slug, slug: tax.slug || 'term-' + digest(tax.label).slice(0, 10) });
  }
  for (const [key, parentSlug] of parentSlugs) {
    const parent = termMap.get('category:' + parentSlug); if (!parent) throw new WeavaError('WordPress 上级分类未包含在文件中：' + parentSlug);
    termMap.get(key)!.parentId = parent.id;
  }
  const existingTerms = site.terms().map((row) => row.value as Term), termIds = new Map<string, string>();
  const pendingTerms = [...termMap], sourceTermIds = new Set(pendingTerms.map(([, term]) => term.id));
  while (pendingTerms.length) {
    const index = pendingTerms.findIndex(([, term]) => !term.parentId || !sourceTermIds.has(term.parentId) || termIds.has(term.parentId));
    if (index < 0) throw new WeavaError('WordPress 分类存在循环层级。');
    const [key, original] = pendingTerms.splice(index, 1)[0];
    const term = { ...original, ...(original.parentId ? { parentId: termIds.get(original.parentId) ?? original.parentId } : {}) };
    if (!existingTerms.some((item) => item.id === term.id)) {
      const sameSlug = existingTerms.find((item) => item.kind === term.kind && item.slug === term.slug);
      const sameLabel = existingTerms.find((item) => item.kind === term.kind && item.label === term.label && item.parentId === term.parentId);
      if (sameSlug) term.id = sameSlug.id;
      else if (sameLabel) { term.id = sameLabel.id; term.slug = sameLabel.slug; warnings.push('分类“' + term.label + '”已关联现有同级分类，保留其网址 ' + term.slug + '。'); }
    }
    termIds.set(original.id, term.id); termMap.set(key, term);
  }
  const typeIds = new Map<string, string>([['post', 'post']]);
  const types: ContentType[] = [];
  for (const item of content.filter((item) => item.type !== 'page')) if (!typeIds.has(item.type) || !types.some((type) => type.id === typeIds.get(item.type))) {
    const id = item.type === 'post' ? 'post' : 'wp-' + item.type.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if ([...typeIds].some(([source, value]) => source !== item.type && value === id)) throw new WeavaError('WordPress 内容类型转换后的编号重复：' + item.type);
    typeIds.set(item.type, id);
    const existing = site.store.get('type', id)?.value;
    types.push(existing ?? { id, label: item.type === 'post' ? '文章' : item.type, fields: [], pathPrefix: item.type === 'post' ? '/posts/' : '/' + id + '/', template: 'article' });
  }
  const paths = new Map<string, string>(), links = new Map<string, string>();
  const fallbackPath = (item: Item, stack = new Set<string>()): string => {
    if (stack.has(item.id)) throw new WeavaError('WordPress 页面上级形成循环。');
    const slug = item.slug || 'item-' + item.id;
    const parent = item.type === 'page' ? content.find((entry) => entry.id === item.parent && entry.type === 'page') : null;
    return parent ? fallbackPath(parent, new Set(stack).add(item.id)) + slug + '/' : (item.type === 'page' ? '/' : item.type === 'post' ? '/posts/' : '/' + typeIds.get(item.type) + '/') + slug + '/';
  };
  for (const item of content) {
    let path = fallbackPath(item);
    try { const url = new URL(item.url, origin); if (!url.searchParams.has('p') && !url.searchParams.has('page_id')) path = url.pathname; } catch {}
    path = normalizePath(path); paths.set(item.id, path);
    for (const url of [item.url, new URL('/?p=' + item.id, origin).href, new URL('/?page_id=' + item.id, origin).href]) if (url) {
      const parsed = new URL(url, origin); links.set(parsed.href.replace(/#.*$/, ''), entryId(item.id));
      if (parsed.origin === origin.origin) links.set(parsed.pathname + parsed.search, entryId(item.id));
    }
  }
  const rewrite = (value: string, contentLink = false) => {
    let url: URL; try { url = new URL(value, origin); } catch { return value; }
    const originalSize = url.pathname.replace(/-\d+x\d+(?=\.[^./]+$)/, '');
    const asset = mediaMap[value] ?? mediaMap[url.href] ?? mediaMap[url.pathname] ?? (originalSize !== url.pathname ? mediaMap[originalSize] : undefined); if (asset) return asset;
    const target = contentLink ? links.get(url.href.replace(/#.*$/, '')) ?? (url.origin === origin.origin ? links.get(url.pathname + url.search) : undefined) : null;
    return target ? 'entry:' + encodeURIComponent(target) + url.hash : value;
  };
  const rewriteHtml = (html: string) => {
    const $ = load(html, null, false);
    for (const attr of ['href', 'src', 'poster']) $('[' + attr + ']').each((_, element) => { const node = $(element); node.attr(attr, rewrite(node.attr(attr)!, attr === 'href')); });
    $('[srcset]').each((_, element) => { const node = $(element); node.attr('srcset', node.attr('srcset')!.split(',').map((part) => { const [url, ...size] = part.trim().split(/\s+/); return [rewrite(url), ...size].join(' '); }).join(', ')); });
    return sanitize($.html());
  };
  const entries: Entry[] = content.map((item) => {
    const conversion: Conversion = { id: entryId(item.id), title: item.title || '未命名内容 ' + item.id, native: [], compatible: [], unresolved: [] }; conversions.push(conversion);
    let blockNumber = 0;
    const block = (type: string, props: Record<string, any>, children?: Block[]): Block => ({ id: 'wp-' + item.id + '-' + ++blockNumber, type, props, ...(children ? { children } : {}) });
    const convert = (source: WpBlock[], references = new Set<string>()): Block[] => source.flatMap((part): Block[] => {
      const html = rewriteHtml(part.html), $ = load(html, null, false), native = (result: Block) => { conversion.native.push(part.name); return [result]; };
      if (['core/group', 'core/column', 'core/columns', 'core/buttons'].includes(part.name) && part.children.length) return native(block(part.name === 'core/columns' ? 'columns' : 'container', part.name === 'core/columns' ? { columns: Math.min(4, part.children.length) } : {}, convert(part.children, references)));
      if (part.name === 'core/block' && part.attrs.ref) {
        const reference = String(part.attrs.ref), target = items.find((entry) => entry.id === reference && entry.type === 'wp_block');
        if (target && !references.has(reference)) { conversion.native.push(part.name); return convert(parseBlocks(target.body), new Set(references).add(reference)); }
        conversion.unresolved.push('可复用区块 ' + reference + ' 不存在或形成循环'); return [];
      }
      if (part.name === 'core/image' && $('img').attr('src')) return native(block('image', { src: $('img').attr('src'), alt: $('img').attr('alt') ?? '', caption: $('figcaption').text() }));
      if (part.name === 'core/gallery' && $('img').length) return native(block('gallery', { images: $('img').toArray().map((element) => ({ src: $(element).attr('src')!, alt: $(element).attr('alt') ?? '', caption: $(element).closest('figure').find('figcaption').first().text() })) }));
      if (part.name === 'core/video' && $('video').attr('src')) return native(block('video', { src: $('video').attr('src'), poster: $('video').attr('poster') ?? '', caption: $('figcaption').text() }));
      if (part.name === 'core/button' && $('a').attr('href')) return native(block('button', { label: $('a').text(), url: $('a').attr('href') }));
      if (part.name === 'core/separator') return native(block('divider', {}));
      if (['core/paragraph', 'core/heading', 'core/list', 'core/quote', 'core/table', 'core/code', 'core/preformatted', 'core/html', 'core/freeform'].includes(part.name)) {
        if (!html.trim()) return []; return native(block('richtext', { text: /<[a-z]/i.test(html) ? html : html.split(/\n\s*\n/).map((line) => '<p>' + line.replaceAll('\n', '<br>') + '</p>').join('') }));
      }
      if (html.trim()) { conversion.compatible.push(part.name); conversion.unresolved.push(part.name + ' 仅保留静态 HTML，请检查原有交互'); return [block('compatibility', { html })]; }
      conversion.unresolved.push(part.name + ' 依赖原网站动态渲染'); return [];
    });
    const blocks = convert(parseBlocks(item.body));
    const shortcodeSource = load(item.body, null, false); shortcodeSource('code,pre').remove();
    for (const match of shortcodeSource.text().matchAll(/\[(?!\/)([a-zA-Z][\w-]*)(?:\s[^\]\r\n]*)?\]/g)) if (!conversion.unresolved.includes('短代码 ' + match[1])) conversion.unresolved.push('短代码 ' + match[1]);
    if (item.password) warnings.push(item.title + '：原密码保护已转为仅站主可见。');
    if (item.status === 'future') warnings.push(item.title + '：保留原计划时间为工作稿，导入后可重新安排发布。');
    const termIds = { categories: [] as string[], tags: [] as string[] };
    for (const tax of item.taxonomies) { const kind = tax.kind === 'post_tag' ? 'tag' : tax.kind, term = termMap.get(kind + ':' + tax.slug); if (term) termIds[kind === 'tag' ? 'tags' : 'categories'].push(term.id); else warnings.push(item.title + '：自定义分类 ' + tax.kind + ' 保存在来源资料中。'); }
    const cover = items.find((asset) => asset.id === item.meta._thumbnail_id?.[0])?.media ?? '';
    return entrySchema.parse({ id: entryId(item.id), kind: item.type === 'page' ? 'page' : 'content', type: item.type === 'page' ? 'post' : typeIds.get(item.type),
      title: conversion.title, path: paths.get(item.id), author: authors.get(item.creator) ?? item.creator, description: titleText(item.meta._yoast_wpseo_metadesc?.[0] || item.meta.rank_math_description?.[0] || item.excerpt),
      cover: cover ? rewrite(cover) : '', categories: termIds.categories.map((id) => [...termMap.values()].find((term) => term.id === id)!.label), tags: termIds.tags.map((id) => [...termMap.values()].find((term) => term.id === id)!.label), termIds,
      blocks: item.type === 'page' ? [block('entry-heading', { cover: 'hide' }), ...blocks] : blocks, document: { version: 1, format: 'html', source: rewriteHtml(item.body) }, status: item.status === 'trash' ? 'archived' : ['publish', 'private'].includes(item.status) ? 'published' : 'draft',
      visibility: item.status === 'private' || item.password ? 'private' : 'public', createdAt: item.date ?? '1970-01-01T00:00:00.000Z', publishedAt: item.date,
      compatibility: { wordpress: { unresolved: conversion.unresolved, reviewed: conversion.unresolved.length === 0 } },
      source: { system: 'wordpress', format: 'wxr', namespace, id: item.id, originalUrl: item.url, originalType: item.type, originalStatus: item.status, originalParent: item.parent, modifiedAt: item.modified, metadata: item.meta, taxonomies: item.taxonomies },
    });
  });
  const existingPaths = new Map(site.store.list('entry').filter((row) => !entries.some((entry) => entry.id === row.id)).map((row) => [row.value.path, row.id]));
  for (const entry of entries) { if (existingPaths.has(entry.path)) throw new WeavaError('导入网址重复：' + entry.path, 409, { existingId: existingPaths.get(entry.path), importedId: entry.id }); existingPaths.set(entry.path, entry.id); }
  const attachments = items.filter((item) => item.type === 'attachment' && item.media).map((item) => ({ id: item.id, url: new URL(item.media, origin).href, title: item.title, caption: titleText(item.excerpt), alt: item.meta._wp_attachment_image_alt?.[0] ?? '', name: basename(new URL(item.media, origin).pathname) }));
  const comments = content.flatMap((item) => item.comments.filter((node) => ['comment', ''].includes(text(node, 'wp:comment_type'))).map((node) => ({
    id: 'wpcomment:' + namespace + ':' + text(node, 'wp:comment_id'), entryId: entryId(item.id), author: titleText(text(node, 'wp:comment_author')) || '访客', body: plain(text(node, 'wp:comment_content')),
    status: text(node, 'wp:comment_approved') === '1' ? 'visible' : 'hidden', createdAt: date(text(node, 'wp:comment_date_gmt')) ?? '1970-01-01T00:00:00.000Z', parent: text(node, 'wp:comment_parent'),
  })));
  if (comments.some((comment) => comment.parent !== '0' && comment.parent)) warnings.push('来源评论的回复关系保留在 WXR 中，本站以时间列表展示。');
  const redirects: NonNullable<SiteExchange['redirects']> = {};
  for (const item of content) {
    const alias = { target: paths.get(item.id)!, entryId: entryId(item.id) };
    redirects['/?p=' + item.id] = alias; if (item.type === 'page') redirects['/?page_id=' + item.id] = alias;
    for (const slug of item.meta._wp_old_slug ?? []) if (slug && !/[/?#\\]/.test(slug)) {
      const path = paths.get(item.id)!.replace(/[^/]+\/$/, slug + '/'); if (path !== alias.target) redirects[path] = alias;
    }
  }
  const value: SiteExchange = { version: 1, types, entries, terms: [...termMap.values()], redirects, ...(options.settings ? { settings: { ...site.settings().value, name: titleText(text(channel, 'title')) || site.settings().value.name, description: titleText(text(channel, 'description')), language: text(channel, 'language') || site.settings().value.language } } : {}) };
  const report = { source: origin.href, fingerprint: digest(xml), totalItems: items.length, entries: entries.length, pages: entries.filter((entry) => entry.kind === 'page').length, content: entries.filter((entry) => entry.kind === 'content').length,
    types: types.map((type) => ({ id: type.id, label: type.label })), terms: termMap.size, attachments: attachments.map(({ id, url, name }) => ({ id, url, name, local: mediaMap[url] ?? null })),
    comments: options.comments === false ? 0 : comments.length, skipped, conversions, warnings: [...new Set(warnings)], reviewRequired: conversions.filter((row) => row.unresolved.length),
    review: { fingerprint: digest(xml), revision: revision(site), releaseId: site.store.state('release') ?? null, options: optionKey(options) }, published: false,
    notes: ['WXR 包含内容资料，主题、插件程序、菜单位置和服务器配置需要另行设置。', '原始 XML 会保存在站点的 imports 目录。未知来源功能需要检查后才能发布。', ...(options.downloadMedia || options.mediaDirectory ? [] : ['附件保留来源网址；本次不会下载附件。'])] };
  return { value, report, attachments, comments };
}
async function attachmentBytes(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new WeavaError('附件下载失败：' + response.status + ' ' + url);
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 32 * 1024 * 1024) throw new WeavaError('附件超过 32 MB：' + url); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function importWordPressWxr(site: Site, xml: string, options: WxrOptions = {}, progress: (message: string) => void = () => {}) {
  const initial = convertWordPressWxr(site, xml, options);
  const checkReview = () => {
    if (options.review && (options.review.fingerprint !== initial.report.fingerprint || options.review.revision !== revision(site) || options.review.releaseId !== (site.store.state('release') ?? null) || options.review.options !== optionKey(options)))
      throw new WeavaError('来源文件、导入选项或站点内容已变化，请重新预检。', 409);
  };
  checkReview();
  if (options.comments !== false) {
    const ids = new Set<string>();
    for (const comment of initial.comments) {
      if (!/\d+$/.test(comment.id) || ids.has(comment.id)) throw new WeavaError('来源评论编号缺失或重复。');
      ids.add(comment.id);
      const old = site.store.raw.prepare('SELECT entry_id,author,body,status,created_at FROM article_comments WHERE id=?').get(comment.id) as any;
      if (old && (old.entry_id !== comment.entryId || old.author !== comment.author || old.body !== comment.body || old.status !== comment.status || old.created_at !== comment.createdAt))
        throw new WeavaError('来源评论与已有评论不同，请先处理冲突，或选择不导入评论。', 409, { id: comment.id });
    }
  }
  const preview = importSite(site, initial.value, { ...options, dryRun: true });
  if (options.dryRun) return { ...initial.report, exchange: preview, dryRun: true, downloaded: 0, importedComments: 0, sourcePath: null };
  const prepared: Awaited<ReturnType<typeof prepareMedia>>[] = [], mediaMap: Record<string, string> = {}; let reusedMedia = 0;
  if (options.downloadMedia || options.mediaDirectory) for (const [index, asset] of initial.attachments.entries()) {
    progress(`正在导入附件 ${index + 1} / ${initial.attachments.length}：${asset.name}`);
    const url = new URL(asset.url, initial.report.source);
    if (!['http:', 'https:'].includes(url.protocol)) throw new WeavaError('附件网址无效：' + asset.url);
    const existing = initial.report.attachments.find((item) => item.id === asset.id)?.local;
    if (existing && existsSync(inside(site.root, existing.slice(1)))) { mediaMap[asset.url] = existing; mediaMap[url.pathname] = existing; reusedMedia++; continue; }
    const bytes = options.mediaDirectory ? readFileSync(inside(options.mediaDirectory, decodeURIComponent(url.pathname).replace(/^\//, ''))) : await attachmentBytes(url.href);
    const row = await prepareMedia(site, bytes, asset.name);
    prepared.push({ ...row, value: { ...row.value, alt: row.value.alt ?? asset.alt, caption: row.value.caption ?? asset.caption } });
    mediaMap[asset.url] = row.value.url; mediaMap[url.href] = row.value.url; mediaMap[url.pathname] = row.value.url;
  }
  const converted = convertWordPressWxr(site, xml, options, mediaMap);
  const archive = join(site.root, 'imports', 'wordpress-wxr', initial.report.fingerprint);
  mkdirSync(archive, { recursive: true });
  const sourcePath = join(archive, 'source.xml'); if (!existsSync(sourcePath)) writeFileSync(sourcePath, xml);
  const result = site.store.raw.transaction(() => {
    checkReview();
    const exchange = importSite(site, converted.value, { ...options, dryRun: false });
    for (const row of prepared) if (!site.store.get('media', row.id)) site.store.put('media', row.id, row.value, null, 'WordPress 附件');
    let comments = 0;
    if (options.comments !== false) for (const comment of converted.comments) {
      const old = site.store.raw.prepare('SELECT entry_id,author,body,status,created_at FROM article_comments WHERE id=?').get(comment.id) as any;
      if (old) { if (old.entry_id !== comment.entryId || old.author !== comment.author || old.body !== comment.body || old.status !== comment.status || old.created_at !== comment.createdAt) throw new WeavaError('来源评论与已有评论不同，未写入导入内容。', 409, { id: comment.id }); continue; }
      site.store.raw.prepare('INSERT INTO article_comments VALUES(?,?,?,?,?,?,?,?,?)').run(comment.id, comment.entryId, digest(comment.id), 'wordpress-import', comment.id, comment.author, comment.body, comment.status, comment.createdAt); comments++;
    }
    const result = { ...converted.report, exchange, dryRun: false, downloaded: prepared.length, reusedMedia, importedComments: comments, sourcePath };
    const old = site.store.get('import-report', initial.report.fingerprint);
    site.store.put('import-report', initial.report.fingerprint, result, old?.revision ?? null, 'WordPress WXR 导入');
    return result;
  }).immediate();
  return result;
}
