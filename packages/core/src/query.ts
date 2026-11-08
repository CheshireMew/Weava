import {WeavaError,fieldSchema,isNoteType,type FieldDefinition,type ContentQuery,type PageResult,type PublishedEntry,type ContentType,type Term} from '@weava/contracts';
import type {Site} from './site.ts';
import {wordpressArchivePage,wordpressPagePath} from './wordpress-archives.ts';
import type {Entry} from '@weava/contracts';
import {queryPublicCatalog} from './public-query.ts';
import {paginate,validateQueryFields,taxonomyIds,queryOrder,compareContent,contentSqlFilters} from './query-rules.ts';
export {paginate,validateQueryFields,taxonomyIds} from './query-rules.ts';
export function queryPublished(site: Site, input: ContentQuery = {}, search = false, releaseId?: string) {
  const release=site.visibleRelease(false,releaseId);
  return release?queryPublicCatalog(site.store.raw,release,input,search):paginate([],input.page??1,input.pageSize??24);
}
export function queryDrafts(site: Site, input: ContentQuery & { status?: string; visibility?: string; format?:'article'|'note' } = {}) {
  const page=input.page??1,pageSize=input.pageSize??24;paginate([],page,pageSize);
  const types=site.store.list('type').map(row=>row.value as ContentType),terms=site.terms().map(row=>row.value as Term);
  validateQueryFields(input,types);
  const {clauses,args}=contentSqlFilters(input,terms,{kind:'l.kind',type:'l.type',author:"json_extract(l.summary,'$.author')",search:'l.search',metadata:'l.summary',fields:'l.fields'});
  const eq=(sql:string,value:any)=>{clauses.push(sql);args.push(value);};
  if(input.format){const ids=types.filter(type=>input.format==='note'?isNoteType(type):!isNoteType(type)).map(type=>type.id);if(ids.length){clauses.push('l.type IN ('+ids.map(()=>'?').join(',')+')');args.push(...ids);}else clauses.push('0=1');}
  if(input.visibility&&input.visibility!=='all')eq('l.visibility=?',input.visibility);
  if(input.status==='published')clauses.push('p.entry_id IS NOT NULL');
  else if(input.status==='changed')clauses.push('p.entry_id IS NOT NULL AND p.revision<>l.revision');
  else if(input.status&&input.status!=='all')eq('p.entry_id IS NULL AND l.status=?',input.status);
  const order=queryOrder(input.sort);
  const from=`FROM entry_list l LEFT JOIN published_entry_revisions p ON p.entry_id=l.id AND p.release_id=(SELECT value FROM state WHERE key='release')${clauses.length?' WHERE '+clauses.join(' AND '):''}`;
  const total=(site.store.raw.prepare('SELECT COUNT(*) n '+from).get(...args) as {n:number}).n;
  const selected=site.store.raw.prepare('SELECT l.id,l.revision,l.summary,l.fields,l.updated_at,p.revision published_revision '+from+' ORDER BY '+order.draft+',l.id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize) as {id:string;revision:number;summary:string;fields:string;updated_at:string;published_revision:number|null}[];
  return {page,pageSize,total,pages:Math.ceil(total/pageSize),items:selected.map(row=>{
    const value=JSON.parse(row.summary),fields=JSON.parse(row.fields),columns=types.find(type=>type.id===value.type)?.admin?.columns??[];
    return {id:row.id,revision:row.revision,updatedAt:row.updated_at,published:row.published_revision!==null,hasChanges:row.published_revision!==row.revision,value:{...value,fields:Object.fromEntries(columns.filter(key=>Object.hasOwn(fields,key)).map(key=>[key,fields[key]]))}};
  })};
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
  const order=queryOrder(input.sort);
  const items = selectEntries(entries, input, types, terms);
  items.sort((a,b)=>compareContent(a,b,order));
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
  const rows=site.store.raw.prepare("SELECT id,revision,title,kind,type,json_extract(summary,'$.path') AS path,updated_at FROM entry_list WHERE "+where+' ORDER BY title COLLATE NOCASE,id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize) as {id:string;revision:number;title:string;kind:Entry['kind'];type:string;path:string;updated_at:string}[];
  return {page,pageSize,total,pages:Math.ceil(total/pageSize),items:rows.map(row=>({id:row.id,revision:row.revision,updatedAt:row.updated_at,value:{id:row.id,title:row.title,path:row.path,kind:row.kind,type:row.type}}))};
}

export function contentQuery(params: URLSearchParams): ContentQuery {
  const fields = Object.fromEntries([...params].filter(([key,value]) => key.startsWith('field.') && value !== '').map(([key, value]) => [key.slice(6), value]));
  const kind = params.get('kind');
  if (kind && !['content', 'page'].includes(kind)) throw new WeavaError('内容种类无效。');
  return { page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? params.get('limit') ?? 24),
    kind: (kind ?? undefined) as ContentQuery['kind'], type: params.get('type') ?? undefined,
    author: params.get('author') ?? undefined, category: params.get('category') ?? undefined, tag: params.get('tag') ?? undefined,
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
