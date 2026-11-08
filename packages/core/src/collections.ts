import type { Block, ContentQuery, PublishedEntry, Release } from '@weava/contracts';
import { paginate, selectEntries } from './query.ts';
import { plain, renderDocument } from './documents.ts';

/** Collections always resolve references against the selected public release. */
export function collectionEntries(release: Release, props: Record<string, any> = {}) {
  const publicEntries = release.entries.filter(e => e.kind === 'content' && e.visibility !== 'private');
  const query: ContentQuery = { kind: 'content', type: props.contentType || undefined,
    category: props.category || undefined, tag: props.tag || undefined, query: props.query || undefined,
    author: props.author || undefined, fields: props.fields || {}, sort: props.sort || 'date' };
  let items: PublishedEntry[] = [];
  // A cross-type catalogue can filter a shared field without weakening field validation.
  for (const type of release.types.filter(t => !query.type || t.id === query.type)) {
    if (Object.keys(query.fields ?? {}).some(key => !type.fields.some(f => f.key === key && f.filterable))) continue;
    items.push(...selectEntries(publicEntries, { ...query, query: undefined, type: type.id }, release.types, release.terms));
  }
  if(query.query) {
    const words=query.query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    items=items.filter(item=>{const text=(item.title+' '+item.description+' '+plain(item.html??renderDocument(item.document))).normalize('NFKC').toLowerCase();return words.every(word=>text.includes(word));});
  }
  if (props.ids) {
    const positions = new Map<string, number>((props.ids as string[]).map((id, i) => [id, i]));
    items = items.filter(e => positions.has(e.id)).sort((a,b) => positions.get(a.id)! - positions.get(b.id)!);
  } else items.sort(query.sort === 'title' ? (a,b) => a.title.localeCompare(b.title, release.settings.language)
    : query.sort === 'oldest' ? (a,b) => String(a.publishedAt ?? '').localeCompare(String(b.publishedAt ?? '')) || a.id.localeCompare(b.id)
    : (a,b) => String(b.publishedAt ?? b.updatedAt ?? '').localeCompare(String(a.publishedAt ?? a.updatedAt ?? '')) || a.id.localeCompare(b.id));
  return items;
}
export function collectionPage(release: Release, block: Block, url: URL) {
  const p = block.props, fields = { ...p.fields };
  for (const [key, value] of url.searchParams) if (key.startsWith('field.') && value) fields[key.slice(6)] = value;
  const match = url.pathname.match(/\/page\/(\d+)\/$/);
  const page = Number(url.searchParams.get('page') || match?.[1] || 1);
  const items = collectionEntries(release, { ...p, fields,
    query: url.searchParams.get('q') || p.query,
    category: url.searchParams.get('category') || p.category,
    sort: url.searchParams.get('sort') || p.sort });
  return paginate(items, page, Math.min(100, Number(p.limit) || 36));
}
export function collectionArchiveEntry(release: Release, url: URL) {
  const match = url.pathname.match(/^(.*\/)page\/([1-9]\d*)\/$/);
  if (!match) return;
  const base = release.entries.find(e => e.kind === 'page' && e.path === match[1]);
  const block = base?.blocks.find(b => b.type === 'collection' && b.props.pagination !== false);
  if (!base || !block || Number(match[2]) > collectionPage(release, block, url).pages) return;
  return { ...base, path: url.pathname };
}
