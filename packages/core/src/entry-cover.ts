import { load } from 'cheerio';
import {isNoteType,type ContentType,type Block,type Entry,type PublishedEntry} from '@weava/contracts';
import { firstDocumentImage } from './document-inspection.ts';

function firstImage(html: string) {
  if(!/<img\b/i.test(html))return '';
  return load(html, null, false)('img[src]').first().attr('src') ?? '';
}
const publishedImages=new WeakMap<object,{html:string;image:string}>();

function firstBodyImage(entry: Entry | PublishedEntry): string {
  if ('html' in entry){
    const cached=publishedImages.get(entry);if(cached?.html===entry.html)return cached.image;
    const image=firstImage(entry.html);publishedImages.set(entry,{html:entry.html,image});return image;
  }
  if (!entry.blocks?.length) return firstDocumentImage(entry.document);
  const visit = (blocks: Block[]): string => {
    for (const block of blocks) {
      const p = block.props;
      let src = '';
      if (['image', 'image-text'].includes(block.type)) src = p.src ?? '';
      else if (block.type === 'hero') src = p.image ?? '';
      else if (block.type === 'gallery') {
        const image = p.images?.[0];
        src = typeof image === 'string' ? image : image?.src ?? '';
      } else if (['text', 'richtext'].includes(block.type)) src = firstDocumentImage({ version: 1, format: 'markdown', source: String(p.text ?? '') });
      else if (block.type === 'compatibility') src = firstImage(String(p.html ?? ''));
      if (src) return src;
      const child = visit(block.children ?? []);
      if (child) return child;
    }
    return '';
  };
  return visit(entry.blocks);
}

/** Use an authored cover or body image; imageless articles keep the layout's light placeholder. */
export function entryCover(entry: Entry | PublishedEntry, definition?:Pick<ContentType,'id'|'format'>): string {
  if(isNoteType(definition??{id:entry.type}))return '';
  return entry.cover || firstBodyImage(entry);
}
