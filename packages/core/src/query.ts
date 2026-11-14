import {
  WeavaError,
  fieldSchema,
  isNoteType,
  type FieldDefinition,
  type ContentQuery,
  type PageResult,
  type PublishedEntry,
  type ContentType,
  type Term,
} from '@weava/contracts';
import type { Site } from './site.ts';
import { wordpressArchivePage, wordpressPagePath } from './wordpress-archives.ts';
import type { Entry } from '@weava/contracts';
import type { EntryRepository } from './entry-repository.ts';
import {
  paginate,
  validateQueryFields,
  taxonomyIds,
  queryOrder,
  compareContent,
  contentSqlFilters,
} from './query-rules.ts';
export { paginate, validateQueryFields, taxonomyIds } from './query-rules.ts';
export function queryPublished(
  site: Pick<Site, 'visibleRelease' | 'publication'>,
  input: ContentQuery = {},
  search = false,
  releaseId?: string,
) {
  const release = site.visibleRelease(false, releaseId);
  return release
    ? site.publication.query(release, input, search)
    : paginate([], input.page ?? 1, input.pageSize ?? 24);
}
export const queryDrafts = (
  site: { entryStore: Pick<EntryRepository, 'query'> },
  input: Parameters<EntryRepository['query']>[0] = {},
) => site.entryStore.query(input);

export function selectEntries(
  entries: PublishedEntry[],
  input: ContentQuery = {},
  types?: ContentType[],
  terms: Term[] = [],
): PublishedEntry[] {
  if (types) validateQueryFields(input, types);
  const categories = input.category ? taxonomyIds(terms, 'category', input.category) : null,
    tags = input.tag ? taxonomyIds(terms, 'tag', input.tag) : null;
  const query = input.query?.normalize('NFKC').toLowerCase();
  return entries.filter(
    (entry) =>
      (!input.kind || entry.kind === input.kind) &&
      (!input.type || entry.type === input.type) &&
      (!input.author || entry.author === input.author) &&
      (!input.category ||
        entry.categories.includes(input.category) ||
        entry.termIds?.categories.some((id) => id === input.category || categories?.has(id))) &&
      (!input.tag ||
        entry.tags.includes(input.tag) ||
        entry.termIds?.tags.some((id) => id === input.tag || tags?.has(id))) &&
      (!query ||
        (entry.title + ' ' + entry.description).normalize('NFKC').toLowerCase().includes(query)) &&
      Object.entries(input.fields ?? {}).every(([key, value]) => {
        const actual = entry.fields[key];
        return (
          actual !== undefined &&
          (Array.isArray(actual)
            ? actual.some((item) => String(item) === String(value))
            : String(actual) === String(value))
        );
      }),
  );
}
export function queryEntries(
  entries: PublishedEntry[],
  input: ContentQuery = {},
  types?: ContentType[],
  terms: Term[] = [],
): PageResult<PublishedEntry> {
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 24;
  const order = queryOrder(input.sort);
  const items = selectEntries(entries, input, types, terms);
  items.sort((a, b) => compareContent(a, b, order));
  return paginate(items, page, pageSize);
}

export const queryReferences = (
  site: { entryStore: Pick<EntryRepository, 'references'> },
  input: Parameters<EntryRepository['references']>[0],
) => site.entryStore.references(input);

export function contentQuery(params: URLSearchParams): ContentQuery {
  const fields = Object.fromEntries(
    [...params]
      .filter(([key, value]) => key.startsWith('field.') && value !== '')
      .map(([key, value]) => [key.slice(6), value]),
  );
  const kind = params.get('kind');
  if (kind && !['content', 'page'].includes(kind)) throw new WeavaError('内容种类无效。');
  return {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? params.get('limit') ?? 24),
    kind: (kind ?? undefined) as ContentQuery['kind'],
    type: params.get('type') ?? undefined,
    author: params.get('author') ?? undefined,
    category: params.get('category') ?? undefined,
    tag: params.get('tag') ?? undefined,
    query: params.get('q') ?? undefined,
    sort: (params.get('sort') ?? undefined) as ContentQuery['sort'],
    fields,
  };
}

/** Validate before Astro starts streaming a page. Only selected page blocks apply. */
export function validatePublicQuery(
  params: URLSearchParams,
  release: import('@weava/contracts').Release,
  blocks: import('@weava/contracts').Block[] = [],
) {
  const query = contentQuery(params);
  paginate([], query.page, query.pageSize);
  if (params.has('type')) validateQueryFields(query, release.types);
  const seen = new Set<string>();
  function visit(items: import('@weava/contracts').Block[]) {
    for (const block of items) {
      if (['cards', 'content-list'].includes(block.type)) {
        const key = String(block.props.pageKey || 'page');
        if (params.has(key)) paginate([], Number(params.get(key)), 1);
        if (block.props.filters === 'show')
          validateQueryFields(
            { type: block.props.contentType, fields: { ...block.props.fields, ...query.fields } },
            release.types,
          );
      }
      if (block.type === 'shared' && !seen.has(block.props.layoutId)) {
        seen.add(block.props.layoutId);
        visit(release.layouts?.find((layout) => layout.id === block.props.layoutId)?.blocks ?? []);
      }
      visit(block.children ?? []);
    }
  }
  visit(blocks);
}
export function pageLinks(result: PageResult<unknown>, url: URL, key = 'page', entry?: Entry) {
  const legacy = key === 'page' && wordpressArchivePage(entry, url) !== null;
  const href = (page: number) => {
    const copy = new URL(url);
    if (legacy) {
      copy.pathname = wordpressPagePath(entry!.path, page);
      copy.searchParams.delete(key);
    } else copy.searchParams.set(key, String(page));
    return copy.pathname + copy.search;
  };
  return {
    previous: result.page > 1 ? href(result.page - 1) : null,
    next: result.page < result.pages ? href(result.page + 1) : null,
  };
}
