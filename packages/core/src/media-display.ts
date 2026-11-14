import { load } from 'cheerio';
import { digest } from '../../runtime-common/src/identity.ts';
import { defaultCoverVariants } from '../../runtime-common/src/default-covers.ts';
import { BoundedCache } from './cache.ts';
import type { MediaRepository } from './media-repository.ts';
export interface MediaDisplaySource {
  media: Pick<MediaRepository, 'get' | 'version'>;
}

const imageCaches = new WeakMap<
  object,
  { stamp: string; attributes: BoundedCache<string, any>; html: BoundedCache<string, string> }
>();
function imageCache(site: MediaDisplaySource) {
  const stamp = site.media.version();
  let cache = imageCaches.get(site.media);
  if (!cache || cache.stamp !== stamp) {
    cache = {
      stamp,
      attributes: new BoundedCache(2048, 2 * 1024 * 1024),
      html: new BoundedCache(128, 8 * 1024 * 1024),
    };
    imageCaches.set(site.media, cache);
  }
  return cache;
}

export function imageAttributes(
  site: MediaDisplaySource,
  src: string,
  display: number | { width: number; height: number; sizes?: string } = 960,
) {
  const displayWidth = typeof display === 'number' ? display : display.width * 2;
  const dimensions =
    typeof display === 'number'
      ? {}
      : {
          width: display.width,
          height: display.height,
          sizes: display.sizes ?? `${display.width}px`,
        };
  const defaults = defaultCoverVariants(src);
  if (defaults)
    return {
      src: (defaults.find((variant) => variant.width >= displayWidth) ?? defaults.at(-1)!).url,
      srcset: defaults.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
      width: 1200,
      height: 675,
      sizes: typeof display === 'number' ? `${display}px` : (display.sizes ?? `${display.width}px`),
      ...dimensions,
    };
  const key = JSON.stringify(display) + ':' + src;
  const cache = imageCache(site),
    old = cache.attributes.get(key);
  if (old) return { ...old };
  const id = /^\/media\/([a-f0-9]{24})\.[a-z]+$/i.exec(src)?.[1];
  const record = id ? site.media.get(id)?.value : null;
  const position = record?.focalPoint
    ? { style: `object-position:${record.focalPoint.x}% ${record.focalPoint.y}%` }
    : {};
  if (!Array.isArray(record?.derivatives) || !record.derivatives.length)
    return {
      src,
      ...(record?.width && record?.height ? { width: record.width, height: record.height } : {}),
      ...position,
      ...dimensions,
    };
  const variants = record.derivatives
    .filter((d: any) => d.url && d.width)
    .sort((a: any, b: any) => a.width - b.width);
  if (!variants.length) return { src, ...position, ...dimensions };
  const result = {
    ...position,
    src: (variants.find((v: any) => v.width >= displayWidth) ?? variants.at(-1)).url,
    srcset: variants.map((v: any) => `${v.url} ${v.width}w`).join(', '),
    sizes: '(max-width: 720px) 100vw, 960px',
    width: record.width,
    height: record.height,
    ...dimensions,
  };
  cache.attributes.set(key, result, JSON.stringify(result).length * 2);
  return { ...result };
}
export function responsiveImages(site: MediaDisplaySource, html: string) {
  if (!html.includes('/media/') && !html.includes('/default-covers/')) return html;
  const cache = imageCache(site),
    key = digest(html),
    old = cache.html.get(key);
  if (old !== undefined) return old;
  const $ = load(html, null, false);
  $('img[src]').each((_i, el) => {
    const node = $(el);
    const attributes = imageAttributes(site, node.attr('src')!);
    if (attributes.style)
      node.attr('style', [node.attr('style'), attributes.style].filter(Boolean).join(';'));
    if (!node.attr('srcset'))
      for (const [key, value] of Object.entries(attributes))
        if (
          key !== 'style' &&
          value !== undefined &&
          (!['width', 'height'].includes(key) || !node.attr(key))
        )
          node.attr(key, String(value));
    if (!node.attr('loading')) node.attr('loading', 'lazy');
    if (!node.attr('decoding')) node.attr('decoding', 'async');
  });
  const result = $.html();
  return cache.html.set(key, result, result.length * 2);
}
