import { entrySchema, WeavaError, type Block, type Entry, type Term } from '@weava/contracts';
import { load } from 'cheerio';
import type { WxrLinks } from './wordpress-wxr-links.ts';
import { titleText, type Item } from './wordpress-wxr-xml.ts';
export interface WxrContentContext {
  entryId: (id: string) => string;
  conversions: Conversion[];
  warnings: string[];
  itemsById: Map<string, Item>;
  termMap: Map<string, Term>;
  typeIds: Map<string, string>;
  authors: Map<string, string>;
  namespace: string;
  links: WxrLinks;
}
export interface Conversion {
  id: string;
  title: string;
  native: string[];
  compatible: string[];
  unresolved: string[];
}
interface WpBlock {
  name: string;
  attrs: Record<string, any>;
  html: string;
  children: WpBlock[];
}
function parseBlocks(body: string): WpBlock[] {
  const roots: WpBlock[] = [],
    stack: { block: WpBlock; start: number }[] = [];
  let cursor = 0;
  for (const match of body.matchAll(/<!--\s*(\/)?wp:([\w/-]+)(?:\s+(\{[\s\S]*?\}))?\s*(\/)?-->/g)) {
    if (!stack.length && match.index! > cursor && body.slice(cursor, match.index).trim())
      roots.push({
        name: 'core/freeform',
        attrs: {},
        html: body.slice(cursor, match.index),
        children: [],
      });
    if (match[1]) {
      const current = stack.pop();
      const name = match[2].includes('/') ? match[2] : 'core/' + match[2];
      if (!current || current.block.name !== name)
        throw new WeavaError('WordPress 区块的开始与结束标记不匹配。');
      current.block.html = body.slice(current.start, match.index);
    } else {
      let attrs: any = {};
      try {
        attrs = match[3] ? JSON.parse(match[3]) : {};
      } catch {
        throw new WeavaError('WordPress 区块属性不是有效 JSON。');
      }
      const block: WpBlock = {
        name: match[2].includes('/') ? match[2] : 'core/' + match[2],
        attrs,
        html: '',
        children: [],
      };
      (stack.at(-1)?.block.children ?? roots).push(block);
      if (!match[4]) stack.push({ block, start: match.index! + match[0].length });
    }
    cursor = match.index! + match[0].length;
  }
  if (stack.length) throw new WeavaError('WordPress 区块标记没有完整结束。');
  if (body.slice(cursor).trim())
    roots.push({ name: 'core/freeform', attrs: {}, html: body.slice(cursor), children: [] });
  return roots;
}
export function convertWxrEntry(item: Item, context: WxrContentContext): Entry {
  const { entryId, conversions, warnings, itemsById, termMap, typeIds, authors, namespace } =
      context,
    { paths, rewrite, rewriteHtml } = context.links;
  const conversion: Conversion = {
    id: entryId(item.id),
    title: item.title || '未命名内容 ' + item.id,
    native: [],
    compatible: [],
    unresolved: [],
  };
  conversions.push(conversion);
  let blockNumber = 0;
  const block = (type: string, props: Record<string, any>, children?: Block[]): Block => ({
    id: 'wp-' + item.id + '-' + ++blockNumber,
    type,
    props,
    ...(children ? { children } : {}),
  });
  const convert = (source: WpBlock[], references = new Set<string>()): Block[] =>
    source.flatMap((part): Block[] => {
      const html = rewriteHtml(part.html),
        $ = load(html, null, false),
        native = (result: Block) => {
          conversion.native.push(part.name);
          return [result];
        };
      if (
        ['core/group', 'core/column', 'core/columns', 'core/buttons'].includes(part.name) &&
        part.children.length
      )
        return native(
          block(
            part.name === 'core/columns' ? 'columns' : 'container',
            part.name === 'core/columns' ? { columns: Math.min(4, part.children.length) } : {},
            convert(part.children, references),
          ),
        );
      if (part.name === 'core/block' && part.attrs.ref) {
        const reference = String(part.attrs.ref),
          target =
            itemsById.get(reference)?.type === 'wp_block' ? itemsById.get(reference) : undefined;
        if (target && !references.has(reference)) {
          conversion.native.push(part.name);
          return convert(parseBlocks(target.body), new Set(references).add(reference));
        }
        conversion.unresolved.push('可复用区块 ' + reference + ' 不存在或形成循环');
        return [];
      }
      if (part.name === 'core/image' && $('img').attr('src'))
        return native(
          block('image', {
            src: $('img').attr('src'),
            alt: $('img').attr('alt') ?? '',
            caption: $('figcaption').text(),
          }),
        );
      if (part.name === 'core/gallery' && $('img').length)
        return native(
          block('gallery', {
            images: $('img')
              .toArray()
              .map((element) => ({
                src: $(element).attr('src')!,
                alt: $(element).attr('alt') ?? '',
                caption: $(element).closest('figure').find('figcaption').first().text(),
              })),
          }),
        );
      if (part.name === 'core/video' && $('video').attr('src'))
        return native(
          block('video', {
            src: $('video').attr('src'),
            poster: $('video').attr('poster') ?? '',
            caption: $('figcaption').text(),
          }),
        );
      if (part.name === 'core/button' && $('a').attr('href'))
        return native(block('button', { label: $('a').text(), url: $('a').attr('href') }));
      if (part.name === 'core/separator') return native(block('divider', {}));
      if (
        [
          'core/paragraph',
          'core/heading',
          'core/list',
          'core/quote',
          'core/table',
          'core/code',
          'core/preformatted',
          'core/html',
          'core/freeform',
        ].includes(part.name)
      ) {
        if (!html.trim()) return [];
        return native(
          block('richtext', {
            text: /<[a-z]/i.test(html)
              ? html
              : html
                  .split(/\n\s*\n/)
                  .map((line) => '<p>' + line.replaceAll('\n', '<br>') + '</p>')
                  .join(''),
          }),
        );
      }
      if (html.trim()) {
        conversion.compatible.push(part.name);
        conversion.unresolved.push(part.name + ' 仅保留静态 HTML，请检查原有交互');
        return [block('compatibility', { html })];
      }
      conversion.unresolved.push(part.name + ' 依赖原网站动态渲染');
      return [];
    });
  const blocks = convert(parseBlocks(item.body));
  const shortcodeSource = load(item.body, null, false);
  shortcodeSource('code,pre').remove();
  for (const match of shortcodeSource
    .text()
    .matchAll(/\[(?!\/)([a-zA-Z][\w-]*)(?:\s[^\]\r\n]*)?\]/g))
    if (!conversion.unresolved.includes('短代码 ' + match[1]))
      conversion.unresolved.push('短代码 ' + match[1]);
  if (item.password) warnings.push(item.title + '：原密码保护已转为仅站主可见。');
  if (item.status === 'future')
    warnings.push(item.title + '：保留原计划时间为工作稿，导入后可重新安排发布。');
  const termIds = { categories: [] as string[], tags: [] as string[] };
  for (const tax of item.taxonomies) {
    const kind = tax.kind === 'post_tag' ? 'tag' : tax.kind,
      term = termMap.get(kind + ':' + tax.slug);
    if (term) termIds[kind === 'tag' ? 'tags' : 'categories'].push(term.id);
    else warnings.push(item.title + '：自定义分类 ' + tax.kind + ' 保存在来源资料中。');
  }
  const cover = itemsById.get(item.meta._thumbnail_id?.[0])?.media ?? '';
  return entrySchema.parse({
    id: entryId(item.id),
    kind: item.type === 'page' ? 'page' : 'content',
    type: item.type === 'page' ? 'post' : typeIds.get(item.type),
    title: conversion.title,
    path: paths.get(item.id),
    author: authors.get(item.creator) ?? item.creator,
    description: titleText(
      item.meta._yoast_wpseo_metadesc?.[0] || item.meta.rank_math_description?.[0] || item.excerpt,
    ),
    cover: cover ? rewrite(cover) : '',
    categories: termIds.categories.map(
      (id) => [...termMap.values()].find((term) => term.id === id)!.label,
    ),
    tags: termIds.tags.map((id) => [...termMap.values()].find((term) => term.id === id)!.label),
    termIds,
    blocks: item.type === 'page' ? [block('entry-heading', { cover: 'hide' }), ...blocks] : blocks,
    document: { version: 1, format: 'html', source: rewriteHtml(item.body) },
    status:
      item.status === 'trash'
        ? 'archived'
        : ['publish', 'private'].includes(item.status)
          ? 'published'
          : 'draft',
    visibility: item.status === 'private' || item.password ? 'private' : 'public',
    createdAt: item.date ?? '1970-01-01T00:00:00.000Z',
    publishedAt: item.date,
    compatibility: {
      wordpress: {
        unresolved: conversion.unresolved,
        reviewed: conversion.unresolved.length === 0,
      },
    },
    source: {
      system: 'wordpress',
      format: 'wxr',
      namespace,
      id: item.id,
      originalUrl: item.url,
      originalType: item.type,
      originalStatus: item.status,
      originalParent: item.parent,
      modifiedAt: item.modified,
      metadata: item.meta,
      taxonomies: item.taxonomies,
    },
  });
}
