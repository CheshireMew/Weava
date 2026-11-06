import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import {isNoteType,type ContentType,type Block,type Entry,type PublishedEntry} from '@weava/contracts';
import { renderDocument } from './documents.ts';

function firstImage(html: string) {
  return load(html, null, false)('img[src]').first().attr('src') ?? '';
}

const defaultCoverIds = [10, 11, 12, 15, 16, 17, 18, 19];
function defaultArticleCover(entry: Entry) {
  if (entry.kind !== 'content') return '';
  const index = createHash('sha256').update(entry.id).digest().readUInt32BE(0) % defaultCoverIds.length;
  return '/default-covers/picsum-' + defaultCoverIds[index] + '.webp';
}

function firstBodyImage(entry: Entry | PublishedEntry): string {
  if ('html' in entry) return firstImage(entry.html);
  if (!entry.blocks?.length) return firstImage(renderDocument(entry.document));
  const visit = (blocks: Block[]): string => {
    for (const block of blocks) {
      const p = block.props;
      let src = '';
      if (['image', 'image-text'].includes(block.type)) src = p.src ?? '';
      else if (block.type === 'hero') src = p.image ?? '';
      else if (block.type === 'gallery') {
        const image = p.images?.[0];
        src = typeof image === 'string' ? image : image?.src ?? '';
      } else if (['text', 'richtext'].includes(block.type)) src = firstImage(renderDocument({ version: 1, format: 'markdown', source: String(p.text ?? '') }));
      else if (block.type === 'compatibility') src = firstImage(String(p.html ?? ''));
      if (src) return src;
      const child = visit(block.children ?? []);
      if (child) return child;
    }
    return '';
  };
  return visit(entry.blocks);
}

/** Manual cover, body image, then a stable local photo for otherwise imageless articles. */
export function entryCover(entry: Entry | PublishedEntry, definition?:Pick<ContentType,'id'|'format'>): string {
  if(isNoteType(definition??{id:entry.type}))return '';
  return entry.cover || firstBodyImage(entry) || defaultArticleCover(entry);
}
