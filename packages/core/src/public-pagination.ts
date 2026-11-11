import { WeavaError, type Block, type Entry, type Release } from '@weava/contracts';
import { layoutFor } from './layouts.ts';
import { collectionPage } from './collections.ts';
import { queryEntries, selectEntries } from './query.ts';
import { notesPath, notesTimeline } from './notes.ts';
import { newsletterCatalog } from './newsletter.ts';
import { wordpressArchivePage } from './wordpress-archives.ts';

/** The same visible lists define both HTTP bounds and canonical query parameters. */
export function publicPagination(entry: Entry | undefined, release: Release) {
  const lists: { key: string; block?: Block; mode?: 'notes' | 'newsletter' }[] = [];
  if (!entry) return lists;
  const template = layoutFor(entry, release), visited = new Set<string>();
  const notes = release.settings.theme !== 'library' && entry.kind === 'page' && entry.path === notesPath(release);
  const newsletter = release.settings.theme === 'newsletter' && template.id === 'newsletter-archive';
  if (notes || newsletter) lists.push({ key: 'page', mode: notes ? 'notes' : 'newsletter' });
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      const collection = block.type === 'collection' && release.settings.theme === 'library' && block.props.presentation === 'catalog' && block.props.pagination !== false;
      if (['cards', 'content-list'].includes(block.type) || collection)
        lists.push({ key: block.type === 'collection' ? 'page' : String(block.props.pageKey || 'page'), block });
      if (block.type === 'shared' && !visited.has(String(block.props.layoutId))) {
        visited.add(String(block.props.layoutId));
        visit(release.layouts?.find(item => item.id === block.props.layoutId)?.blocks ?? []);
      }
      visit(block.children ?? []);
    }
  };
  if (!notes && !newsletter) { visit(entry.blocks); visit(template.blocks); }
  for (const id of Object.values(release.settings.regions ?? {})) visit(release.layouts?.find(item => item.id === id)?.blocks ?? []);
  return lists;
}

export function validatePagePagination(entry: Entry | undefined, release: Release, url: URL) {
  if (!entry) return;
  const pathPage = /\/page\/([1-9]\d*)\/$/.exec(url.pathname)?.[1];
  const inRange = new Map<string, boolean>();
  for (const list of publicPagination(entry, release)) {
    const value = url.searchParams.get(list.key) ?? (list.key === 'page' ? pathPage : undefined);
    if (value === undefined || value === null) continue;
    const page = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(page)) throw new WeavaError('分页地址无效。', 404);
    if (page === 1) continue;
    const p = list.block?.props ?? {};
    let pages: number;
    if (list.mode === 'notes') pages = Math.ceil(notesTimeline(release).length / 20);
    else if (list.mode === 'newsletter') {
      const block = entry.blocks.find(item => ['cards', 'content-list'].includes(item.type));
      const props = block?.props ?? {};
      pages = Math.ceil(selectEntries(newsletterCatalog(release).posts, { kind: 'content', type: props.contentType,
        author: props.author, category: props.category, tag: props.tag, query: props.query, fields: props.fields }, release.types, release.terms).length / Math.min(100, Number(props.limit) || 24));
    } else if (list.block?.type === 'collection') pages = collectionPage(release, list.block, url).pages;
    else {
      const fields = { ...p.fields };
      if (p.filters === 'show') for (const [key, value] of url.searchParams) if (key.startsWith('field.') && value) fields[key.slice(6)] = value;
      pages = queryEntries(release.entries.filter(item => item.visibility !== 'private'), { kind: 'content', type: p.contentType,
        author: p.author, category: p.category, tag: p.tag, query: p.query, sort: p.sort, fields,
        page: wordpressArchivePage(entry, url) ?? page, pageSize: Math.max(1, Math.min(100, Number(p.limit) || 24)) }, release.types, release.terms).pages;
    }
    inRange.set(list.key, Boolean(inRange.get(list.key)) || page <= pages);
  }
  if ([...inRange.values()].includes(false)) throw new WeavaError('分页不存在。', 404);
}
