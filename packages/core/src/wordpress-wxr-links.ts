import { WeavaError } from '@weava/contracts';
import { load } from 'cheerio';
import { sanitize } from './documents.ts';
import { normalizePath } from './paths.ts';
import type { Item } from './wordpress-wxr-xml.ts';
export function wxrLinks(
  content: Item[],
  typeIds: Map<string, string>,
  origin: URL,
  entryId: (id: string) => string,
  mediaMap: Record<string, string>,
) {
  const contentById = new Map(content.map((item) => [item.id, item]));
  const paths = new Map<string, string>(),
    links = new Map<string, string>();
  const fallbackPath = (item: Item, stack = new Set<string>()): string => {
    if (stack.has(item.id)) throw new WeavaError('WordPress 页面上级形成循环。');
    const slug = item.slug || 'item-' + item.id;
    const parent =
      item.type === 'page'
        ? contentById.get(item.parent)?.type === 'page'
          ? contentById.get(item.parent)
          : undefined
        : null;
    return parent
      ? fallbackPath(parent, new Set(stack).add(item.id)) + slug + '/'
      : (item.type === 'page'
          ? '/'
          : item.type === 'post'
            ? '/posts/'
            : '/' + typeIds.get(item.type) + '/') +
          slug +
          '/';
  };
  for (const item of content) {
    let path = fallbackPath(item);
    try {
      const url = new URL(item.url, origin);
      if (!url.searchParams.has('p') && !url.searchParams.has('page_id')) path = url.pathname;
    } catch {}
    path = normalizePath(path);
    paths.set(item.id, path);
    for (const url of [
      item.url,
      new URL('/?p=' + item.id, origin).href,
      new URL('/?page_id=' + item.id, origin).href,
    ])
      if (url) {
        const parsed = new URL(url, origin);
        links.set(parsed.href.replace(/#.*$/, ''), entryId(item.id));
        if (parsed.origin === origin.origin)
          links.set(parsed.pathname + parsed.search, entryId(item.id));
      }
  }
  const rewrite = (value: string, contentLink = false) => {
    let url: URL;
    try {
      url = new URL(value, origin);
    } catch {
      return value;
    }
    const originalSize = url.pathname.replace(/-\d+x\d+(?=\.[^./]+$)/, '');
    const asset =
      mediaMap[value] ??
      mediaMap[url.href] ??
      mediaMap[url.pathname] ??
      (originalSize !== url.pathname ? mediaMap[originalSize] : undefined);
    if (asset) return asset;
    const target = contentLink
      ? (links.get(url.href.replace(/#.*$/, '')) ??
        (url.origin === origin.origin ? links.get(url.pathname + url.search) : undefined))
      : null;
    return target ? 'entry:' + encodeURIComponent(target) + url.hash : value;
  };
  const rewriteHtml = (html: string) => {
    const $ = load(html, null, false);
    for (const attr of ['href', 'src', 'poster'])
      $('[' + attr + ']').each((_, element) => {
        const node = $(element);
        node.attr(attr, rewrite(node.attr(attr)!, attr === 'href'));
      });
    $('[srcset]').each((_, element) => {
      const node = $(element);
      node.attr(
        'srcset',
        node
          .attr('srcset')!
          .split(',')
          .map((part) => {
            const [url, ...size] = part.trim().split(/\s+/);
            return [rewrite(url), ...size].join(' ');
          })
          .join(', '),
      );
    });
    return sanitize($.html());
  };
  return { paths, rewrite, rewriteHtml };
}
export type WxrLinks = ReturnType<typeof wxrLinks>;
