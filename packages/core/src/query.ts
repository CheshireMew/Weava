import { WeavaError, referenceMatches, fieldSchema, type FieldDefinition, type ContentQuery, type PageResult, type PublishedEntry, type ContentType, type Term } from '@weava/contracts';
import type { Site } from './site.ts';
import { wordpressArchivePage, wordpressPagePath } from './wordpress-archives.ts';
import type { Entry } from '@weava/contracts';
import { queryPublicCatalog } from './public-query.ts';
import { entryCover } from './entry-cover.ts';
export function queryPublished(site: Site, input: ContentQuery = {}, search = false, releaseId?: string) {
  const release=site.visibleRelease(false,releaseId);
  return release?queryPublicCatalog(site.store.raw,release,input,search):paginate([],input.page??1,input.pageSize??24);
}
export function queryDrafts(site: Site, input: ContentQuery & { status?: string; visibility?: string } = {}) {
  const page=input.page??1,pageSize=input.pageSize??24;paginate([],page,pageSize);
  const types=site.store.list('type').map(row=>row.value as ContentType),terms=site.terms().map(row=>row.value as Term);
  validateQueryFields(input,types);
  const clauses:string[]=[],args:any[]=[];
  const eq=(sql:string,value:any)=>{clauses.push(sql);args.push(value);};
  if(input.kind)eq('l.kind=?',input.kind);
  if(input.type)eq('l.type=?',input.type);
  if(input.visibility&&input.visibility!=='all')eq('l.visibility=?',input.visibility);
  if(input.status==='published')clauses.push('p.entry_id IS NOT NULL');
  else if(input.status==='changed')clauses.push('p.entry_id IS NOT NULL AND p.revision<>l.revision');
  else if(input.status&&input.status!=='all')eq('p.entry_id IS NULL AND l.status=?',input.status);
  if(input.query)eq('instr(l.search,?)>0',input.query.normalize('NFKC').toLowerCase());
  for(const [kind,key,filter]of [['category','categories',input.category],['tag','tags',input.tag]] as const)if(filter){
    const ids=[...taxonomyIds(terms,kind,filter),filter];
    clauses.push(`(EXISTS(SELECT 1 FROM json_each(l.summary,?) WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(l.summary,?) WHERE value IN (${ids.map(()=>'?').join(',')})))`);
    args.push('$.'+key,filter,'$.termIds.'+key,...ids);
  }
  for(const [key,value]of Object.entries(input.fields??{})){
    clauses.push(`EXISTS(SELECT 1 FROM json_each(l.fields,?) WHERE CASE type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END=?)`);
    args.push('$.'+JSON.stringify(key),String(value));
  }
  const orders:Record<string,string>={title:'l.title COLLATE NOCASE ASC','-title':'l.title COLLATE NOCASE DESC',updatedAt:'l.updated_at ASC','-updatedAt':'l.updated_at DESC',publishedAt:'l.published_at ASC','-publishedAt':'l.published_at DESC',date:'l.published_at DESC',oldest:'l.published_at ASC'};
  if(input.sort&&!orders[input.sort])throw new WeavaError('排序方式无效。');
  const from=`FROM entry_list l LEFT JOIN published_entry_revisions p ON p.entry_id=l.id AND p.release_id=(SELECT value FROM state WHERE key='release')${clauses.length?' WHERE '+clauses.join(' AND '):''}`;
  const total=(site.store.raw.prepare('SELECT COUNT(*) n '+from).get(...args) as {n:number}).n;
  const selected=site.store.raw.prepare('SELECT l.id,l.revision,l.summary,l.fields,l.updated_at,p.revision published_revision '+from+' ORDER BY '+orders[input.sort??'date']+',l.id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize) as {id:string;revision:number;summary:string;fields:string;updated_at:string;published_revision:number|null}[];
  return {page,pageSize,total,pages:Math.ceil(total/pageSize),items:selected.map(row=>{
    const value=JSON.parse(row.summary),fields=JSON.parse(row.fields),columns=types.find(type=>type.id===value.type)?.admin?.columns??[];
    if (!value.cover && value.kind === 'content') {
      const entry = site.store.get('entry', row.id);
      if (entry) value.cover = entryCover(entry.value);
    }
    return {id:row.id,revision:row.revision,updatedAt:row.updated_at,published:row.published_revision!==null,hasChanges:row.published_revision!==row.revision,value:{...value,fields:Object.fromEntries(columns.filter(key=>Object.hasOwn(fields,key)).map(key=>[key,fields[key]]))}};
  })};
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
    (!input.kind || entry.kind === input.kind) && (!input.type || entry.type === input.type) && (!input.author || entry.author === input.author) &&
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
  const field=fieldSchema.parse({key:'reference',label:'内容引用',type:'reference',referenceTypes:input.referenceTypes,referenceFilters:input.referenceFilters});
  const page=input.page??1,pageSize=input.pageSize??24;paginate([],page,pageSize);
  const clauses=["status<>'archived'"],args:any[]=[];
  if(field.referenceTypes){clauses.push(`kind='content' AND type IN (${field.referenceTypes.map(()=>'?').join(',')})`);args.push(...field.referenceTypes);}
  if(input.query){clauses.push('instr(search,?)>0');args.push(input.query.normalize('NFKC').toLowerCase());}
  for(const [key,expected]of Object.entries(field.referenceFilters??{})){
    const type=typeof expected==='boolean'?(expected?'true':'false'):typeof expected==='number'?'integer,real':'text';
    clauses.push(`EXISTS(SELECT 1 FROM json_each(fields,?) WHERE type IN (${type.split(',').map(()=>'?').join(',')}) AND CAST(value AS TEXT)=?)`);
    args.push('$.'+JSON.stringify(key),...type.split(','),typeof expected==='boolean'?(expected?'1':'0'):String(expected));
  }
  const where=clauses.join(' AND '),total=(site.store.raw.prepare('SELECT COUNT(*) n FROM entry_list WHERE '+where).get(...args) as {n:number}).n;
  const rows=site.store.raw.prepare('SELECT id FROM entry_list WHERE '+where+' ORDER BY title COLLATE NOCASE,id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize) as {id:string}[];
  return {page,pageSize,total,pages:Math.ceil(total/pageSize),items:rows.map(row=>site.store.get('entry',row.id)!)};
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

/** Validate before Astro starts streaming a page. Only selected page blocks apply. */
export function validatePublicQuery(params: URLSearchParams, release: import('@weava/contracts').Release, blocks: import('@weava/contracts').Block[] = []) {
  const query = contentQuery(params);
  paginate([], query.page, query.pageSize);
  if (params.has('type')) validateQueryFields(query, release.types);
  const seen = new Set<string>();
  function visit(items: import('@weava/contracts').Block[]) {
    for (const block of items) {
      if (['cards','content-list'].includes(block.type)) {
        const key = String(block.props.pageKey || 'page');
        if (params.has(key)) paginate([], Number(params.get(key)), 1);
        if (block.props.filters === 'show') validateQueryFields({ type: block.props.contentType, fields: { ...block.props.fields, ...query.fields } }, release.types);
      }
      if (block.type === 'shared' && !seen.has(block.props.layoutId)) { seen.add(block.props.layoutId); visit(release.layouts?.find((layout) => layout.id === block.props.layoutId)?.blocks ?? []); }
      visit(block.children ?? []);
    }
  }
  visit(blocks);
}
export function pageLinks(result: PageResult<unknown>, url: URL, key = 'page', entry?: Entry) {
  const legacy = key === 'page' && wordpressArchivePage(entry, url) !== null;
  const href = (page: number) => { const copy = new URL(url);
    if (legacy) { copy.pathname = wordpressPagePath(entry!.path, page); copy.searchParams.delete(key); }
    else copy.searchParams.set(key, String(page));
    return copy.pathname + copy.search;
  };
  return { previous: result.page > 1 ? href(result.page - 1) : null, next: result.page < result.pages ? href(result.page + 1) : null };
}
