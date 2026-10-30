import { WeavaError, referenceMatches, fieldSchema, type FieldDefinition, type ContentQuery, type PageResult, type PublishedEntry, type ContentType, type Term } from '@weava/contracts';
import type { Site } from './site.ts';
export function queryPublished(site: Site, input: ContentQuery = {}, search = false, releaseId?: string) {
  const release = site.visibleRelease(false, releaseId), entries = release?.entries ?? [];
  const hits = search && input.query?.trim() ? new Set(site.search(input.query, releaseId).map((item) => item.id)) : null;
  return queryEntries(hits ? entries.filter((entry) => hits.has(entry.id)) : entries,
    { ...input, ...(search ? { query: undefined } : { kind: input.kind ?? 'content' }) }, release?.types ?? [], release?.terms ?? []);
}
export function queryDrafts(site: Site, input: ContentQuery & { status?: string; visibility?: string } = {}) {
  const summaries = new Map(site.entries().map((row) => [row.id, row]));
  const drafts = site.store.list('entry').filter((row) => {
    const summary = summaries.get(row.id)!;
    return (!input.visibility || input.visibility === 'all' || (row.value.visibility ?? 'public') === input.visibility) &&
      (!input.status || input.status === 'all' || (input.status === 'published' ? summary.published :
        input.status === 'changed' ? summary.published && summary.hasChanges : row.value.status === input.status && !summary.published));
  });
  const result = queryEntries(drafts.map((row) => ({ ...row.value, html: '', modifiedAt: row.updatedAt, revisionId: row.revision })), input, site.store.list('type').map((row) => row.value), site.terms().map((row) => row.value));
  return { ...result, items: result.items.map((entry) => {
    const row = summaries.get(entry.id)!, columns = site.store.get('type', entry.type)?.value.admin?.columns ?? [];
    return { ...row, value: { ...row.value, fields: Object.fromEntries(columns.filter((key: string) => Object.hasOwn(entry.fields, key)).map((key: string) => [key, entry.fields[key]])) } };
  }) };
}
export function paginate<T>(items: T[], page = 1, pageSize = 24): PageResult<T> {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new WeavaError('页码或每页数量无效，每页最多 100 项。');
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length, pages: Math.ceil(items.length / pageSize) };
}

export function validateQueryFields(input: ContentQuery, types: ContentType[]) {
  const fields = Object.entries(input.fields ?? {}); if (!fields.length) return;
  const type = types.find((type) => type.id === input.type);
  if (!type) throw new WeavaError('字段筛选需要选择内容类型。');
  for (const [key, value] of fields) {
    const field = type.fields.find((field) => field.key === key && field.filterable);
    if (!field) throw new WeavaError('字段未声明为可筛选：' + key);
    if (field.type === 'number' && !Number.isFinite(Number(value)) || field.type === 'boolean' && !['true', 'false'].includes(String(value)) || field.type === 'date' && !Number.isFinite(Date.parse(String(value))) || field.type === 'select' && !field.options?.includes(String(value))) throw new WeavaError('字段筛选值无效：' + field.label);
  }
}
export function taxonomyIds(catalog: Term[], kind: Term['kind'], value: string) {
  const ids = new Set(catalog.filter((term) => term.kind === kind && [term.id, term.label, term.slug].includes(value)).map((term) => term.id));
  if (kind === 'category') { let changed = true; while (changed) { changed = false; for (const term of catalog) if (term.kind === kind && term.parentId && ids.has(term.parentId) && !ids.has(term.id)) { ids.add(term.id); changed = true; } } }
  return ids;
}
export function selectEntries(entries: PublishedEntry[], input: ContentQuery = {}, types?: ContentType[], terms: Term[] = []): PublishedEntry[] {
  if (types) validateQueryFields(input, types);
  const categories = input.category ? taxonomyIds(terms, 'category', input.category) : null, tags = input.tag ? taxonomyIds(terms, 'tag', input.tag) : null;
  const query = input.query?.normalize('NFKC').toLowerCase();
  return entries.filter((entry) =>
    (!input.kind || entry.kind === input.kind) && (!input.type || entry.type === input.type) &&
    (!input.category || entry.categories.includes(input.category) || entry.termIds?.categories.some((id) => id === input.category || categories?.has(id))) &&
    (!input.tag || entry.tags.includes(input.tag) || entry.termIds?.tags.some((id) => id === input.tag || tags?.has(id))) &&
    (!query || (entry.title + ' ' + entry.description).normalize('NFKC').toLowerCase().includes(query)) &&
    Object.entries(input.fields ?? {}).every(([key, value]) => {
      const actual = entry.fields[key];
      return actual !== undefined && (Array.isArray(actual) ? actual.some((item) => String(item) === String(value)) : String(actual) === String(value));
    }));
}
export function queryEntries(entries: PublishedEntry[], input: ContentQuery = {}, types?: ContentType[], terms: Term[] = []): PageResult<PublishedEntry> {
  const page = input.page ?? 1, pageSize = input.pageSize ?? 24;
  if (input.sort && !['date', 'oldest', 'title', '-title', 'publishedAt', '-publishedAt', 'updatedAt', '-updatedAt'].includes(input.sort)) throw new WeavaError('排序方式无效。');
  const items = selectEntries(entries, input, types, terms);
  items.sort((a, b) => {
    const value = input.sort === 'title' || input.sort === '-title' ? a.title.localeCompare(b.title) * (input.sort === '-title' ? -1 : 1) :
      input.sort === 'updatedAt' || input.sort === '-updatedAt' ? String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? '')) * (input.sort.startsWith('-') ? -1 : 1) :
      input.sort === 'publishedAt' ? String(a.publishedAt ?? '').localeCompare(String(b.publishedAt ?? '')) :
      String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) * (input.sort === 'oldest' ? -1 : 1);
    return value || a.id.localeCompare(b.id);
  });
  return paginate(items, page, pageSize);
}

export function queryReferences(site: Site, input: { referenceTypes?: string[]; referenceFilters?: FieldDefinition['referenceFilters']; query?: string; page?: number; pageSize?: number }) {
  const field = fieldSchema.parse({ key: 'reference', label: '内容引用', type: 'reference', referenceTypes: input.referenceTypes, referenceFilters: input.referenceFilters });
  const q = input.query?.normalize('NFKC').toLowerCase();
  const rows = site.store.list('entry').filter((row) => row.value.status !== 'archived' && referenceMatches(field, row.value) && (!q || (row.value.title + ' ' + row.value.description).normalize('NFKC').toLowerCase().includes(q)));
  rows.sort((a, b) => a.value.title.localeCompare(b.value.title) || a.id.localeCompare(b.id));
  return paginate(rows, input.page, input.pageSize);
}
export function contentQuery(params: URLSearchParams): ContentQuery {
  const fields = Object.fromEntries([...params].filter(([key,value]) => key.startsWith('field.') && value !== '').map(([key, value]) => [key.slice(6), value]));
  const kind = params.get('kind');
  if (kind && !['content', 'page'].includes(kind)) throw new WeavaError('内容种类无效。');
  return { page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? params.get('limit') ?? 24),
    kind: (kind ?? undefined) as ContentQuery['kind'], type: params.get('type') ?? undefined,
    category: params.get('category') ?? undefined, tag: params.get('tag') ?? undefined,
    query: params.get('q') ?? undefined, sort: (params.get('sort') ?? 'date') as ContentQuery['sort'], fields };
}

export function pageLinks(result: PageResult<unknown>, url: URL, key = 'page') {
  const href = (page: number) => { const copy = new URL(url); copy.searchParams.set(key, String(page)); return copy.pathname + copy.search; };
  return { previous: result.page > 1 ? href(result.page - 1) : null, next: result.page < result.pages ? href(result.page + 1) : null };
}
