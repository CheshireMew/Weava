import type { Entry } from '@weava/contracts';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

/** Imported dates apply only while the imported, visible content is unchanged. */
export function sourceContentHash(entry: Entry) {
  return createHash('sha256').update(JSON.stringify({
    title: entry.title, description: entry.description, author: entry.author,
    cover: entry.cover, document: entry.document, blocks: entry.blocks,
    fields: entry.fields, categories: entry.categories, tags: entry.tags,
  })).digest('hex');
}

export function publicationModifiedAt(entry: Entry, updatedAt: string) {
  const date = entry.source?.modifiedAt;
  return typeof date === 'string' && Number.isFinite(Date.parse(date)) &&
    entry.source?.importedContentHash === sourceContentHash(entry) ? date : updatedAt;
}

/** Keep public image URLs while native media records continue to own the copied files. */
export function originalWordPressImages(html: string, entry?: Entry) {
  const urls = entry?.source?.wordpressMediaUrls;
  if (!urls) return html;
  const expected = entry.source?.importedContentHash;
  // A published snapshot can fill an empty authored summary automatically.
  // That derived text does not turn a format-only import into an owner edit.
  const unchanged = expected === sourceContentHash(entry) ||
    'revisionId' in entry && entry.summaryMode === 'auto' && expected === sourceContentHash({ ...entry, description: '' });
  if (!unchanged) return html;
  const $ = load(html, null, false);
  $('img[src]').each((_i, node) => {
    const image = $(node), original = urls[image.attr('src') ?? ''];
    if (typeof original === 'string' && /^https?:\/\//.test(original)) image.attr('src', original).removeAttr('srcset').removeAttr('sizes');
  });
  return $.html();
}
