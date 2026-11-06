import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { BoundedCache } from '../../../packages/core/src/cache.ts';

const cache = new BoundedCache<string, string | null>(32, 256 * 1024);
const tags = [...sanitizeHtml.defaults.allowedTags, 'style', 'img', 'picture', 'source'];
const passiveTags = new Set(tags);

/** Passive ads can participate in the first page layout; executable ads stay sandboxed. */
export function staticAdvertisement(html: string): string | null {
  const known = cache.get(html);
  if (known !== undefined) return known;
  const $ = load(html, undefined, false);
  const executable = $('*').toArray().some(element =>
    'tagName' in element && (!passiveTags.has(element.tagName) || Object.keys(element.attribs).some(name => /^on/i.test(name))),
  );
  // Unknown image dimensions and external styles cannot reserve their size on first paint.
  const unknownImage = $('img').toArray().some(element =>
    !(Number(element.attribs.width) > 0 && Number(element.attribs.height) > 0),
  );
  if (executable || unknownImage || /@(?:import|font-face)\b/i.test($('style').text()))
    return cache.set(html, null, html.length * 2 + 64);
  const rendered = sanitizeHtml(html, {
    allowedTags: tags,
    allowedAttributes: {
      '*': ['id', 'class', 'style', 'title', 'lang', 'dir', 'aria-*'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
      source: ['src', 'srcset', 'sizes', 'type', 'media'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    allowVulnerableTags: true,
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: { ...attributes, ...(attributes.target === '_blank'
          ? { rel: [...new Set([...(attributes.rel ?? '').split(/\s+/).filter(Boolean), 'noopener', 'noreferrer'])].join(' ') }
          : {}) },
      }),
    },
  });
  return cache.set(html, rendered, (html.length + rendered.length) * 2 + 64);
}
