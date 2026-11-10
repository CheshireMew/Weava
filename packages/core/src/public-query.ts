import type Database from 'better-sqlite3';
import type {Release,ContentQuery,PublishedEntry} from '@weava/contracts';

import {publishedMetadata} from './release-reader.ts';
import {releaseIndex} from './release-index.ts';
import {tokens} from './documents.ts';
import {validateQueryFields,paginate,queryOrder,querySorts,compareContent,contentSqlFilters} from './query-rules.ts';
const loaded=new WeakMap<Database.Database,Release>();
const matched=new WeakMap<Database.Database,{release:Release;query:string}>();
function catalog(db:Database.Database,release:Release){
  if(loaded.get(db)===release)return;
  const sorts=Object.keys(querySorts).filter(sort=>sort!=='relevance') as (keyof typeof querySorts)[];
  const orders=new Map<string,Map<string,number>>();
  for(const sort of sorts){
    const entries=[...release.entries].sort((a,b)=>compareContent(a,b,querySorts[sort]));orders.set(sort,new Map(entries.map((entry,index)=>[entry.id,index])));
  }
  db.transaction(()=>{
    db.exec(`DROP TABLE IF EXISTS temp.weava_public_catalog;CREATE TEMP TABLE weava_public_catalog(id TEXT PRIMARY KEY,kind TEXT,type TEXT,author TEXT,search TEXT,metadata TEXT,indexable INTEGER,sort_title INTEGER,sort_title_desc INTEGER,sort_updated INTEGER,sort_updated_desc INTEGER,sort_published INTEGER,sort_date INTEGER,sort_published_desc INTEGER,sort_oldest INTEGER);
      CREATE INDEX temp.weava_public_kind ON weava_public_catalog(kind,type);`);
    const insert=db.prepare('INSERT INTO weava_public_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const entry of release.entries)insert.run(entry.id,entry.kind,entry.type,entry.author??'',(entry.title+' '+entry.description).normalize('NFKC').toLowerCase(),JSON.stringify(publishedMetadata(entry)),entry.indexable?1:0,...sorts.map(sort=>orders.get(sort)!.get(entry.id)!));
  })();loaded.set(db,release);matched.delete(db);
}
/** Query only metadata and the requested result page; content bodies remain lazy. */
export function queryPublicCatalog(db:Database.Database,release:Release,input:ContentQuery,search=false){
  const page=input.page??1,pageSize=input.pageSize??24;paginate([],page,pageSize);validateQueryFields(input,release.types);
  const order=queryOrder(input.sort);
  catalog(db,release);
  const {clauses,args}=contentSqlFilters({...input,kind:input.kind??(search?undefined:'content'),query:search?undefined:input.query},release.terms??[],{kind:'c.kind',type:'c.type',author:'c.author',search:'c.search',metadata:'c.metadata',fields:"json_extract(c.metadata,'$.fields')"});
  if(search&&input.query?.trim()){
    const terms=tokens(input.query).split(' ').filter(Boolean);
    if(!terms.length)return {items:[] as PublishedEntry[],page,pageSize,total:0,pages:0};
    const match=terms.map(term=>'"'+term.replaceAll('"','')+'"').join(' AND ');
    {
      const old=matched.get(db);
      if(old?.release!==release||old.query!==match){
        db.transaction(()=>{db.exec('CREATE TEMP TABLE IF NOT EXISTS weava_public_matches(id TEXT PRIMARY KEY,score REAL NOT NULL);DELETE FROM weava_public_matches;');
          db.prepare('INSERT OR IGNORE INTO weava_public_matches SELECT m.entry_id,bm25(publication_fts) FROM publication_fts f JOIN publication_members m ON m.object_key=f.object_key WHERE publication_fts MATCH ? AND m.release_id=?').run(match,release.id);})();
        matched.set(db,{release,query:match});
      }
      clauses.push('c.indexable=1 AND c.id IN (SELECT id FROM weava_public_matches)');
    }
  }
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=(db.prepare('SELECT COUNT(*) n FROM weava_public_catalog c'+where).get(...args) as {n:number}).n;
  const relevance = search && !!input.query?.trim() && (!input.sort || input.sort === 'relevance');
  const sorting = relevance ? "CASE WHEN instr(lower(json_extract(c.metadata,'$.title')),?)>0 THEN 0 ELSE 1 END,(SELECT score FROM weava_public_matches WHERE id=c.id),c.sort_date,c.id" : 'c.' + order.catalog + ',c.id';
  const rows=db.prepare('SELECT c.id FROM weava_public_catalog c'+where+' ORDER BY '+sorting+' LIMIT ? OFFSET ?').all(...args,...(relevance?[input.query!.normalize('NFKC').toLowerCase()]:[]),pageSize,(page-1)*pageSize) as {id:string}[];
  const entries=releaseIndex(release).byId;return {items:rows.map(row=>entries.get(row.id)!),page,pageSize,total,pages:Math.ceil(total/pageSize)};
}
