import type Database from 'better-sqlite3';
import type { Release,ContentQuery,PublishedEntry } from '@weava/contracts';
import { WeavaError } from '../../contracts/src/errors.ts';
import { publishedMetadata } from './release-reader.ts';
import { releaseIndex } from './release-index.ts';
import { tokens } from './documents.ts';
import { taxonomyIds,validateQueryFields,paginate } from './query.ts';
const loaded=new WeakMap<Database.Database,Release>();
const matched=new WeakMap<Database.Database,{release:Release;query:string}>();
function catalog(db:Database.Database,release:Release){
  if(loaded.get(db)===release)return;
  const sorts=['title','-title','updatedAt','-updatedAt','publishedAt','date','oldest'] as const;
  const orders=new Map<string,Map<string,number>>();
  for(const sort of sorts){
    const entries=[...release.entries].sort((a,b)=>{
      const value=sort.includes('title')?a.title.localeCompare(b.title)*(sort[0]==='-'?-1:1):sort.includes('updatedAt')?String(a.updatedAt??'').localeCompare(String(b.updatedAt??''))*(sort[0]==='-'?-1:1):String(a.publishedAt??'').localeCompare(String(b.publishedAt??''))*(sort==='date'?-1:1);
      return value||a.id.localeCompare(b.id);
    });orders.set(sort,new Map(entries.map((entry,index)=>[entry.id,index])));
  }
  db.transaction(()=>{
    db.exec(`DROP TABLE IF EXISTS temp.weava_public_catalog;CREATE TEMP TABLE weava_public_catalog(id TEXT PRIMARY KEY,kind TEXT,type TEXT,author TEXT,search TEXT,metadata TEXT,indexable INTEGER,sort_title INTEGER,sort_title_desc INTEGER,sort_updated INTEGER,sort_updated_desc INTEGER,sort_published INTEGER,sort_date INTEGER,sort_oldest INTEGER);
      CREATE INDEX temp.weava_public_kind ON weava_public_catalog(kind,type);`);
    const insert=db.prepare('INSERT INTO weava_public_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const entry of release.entries)insert.run(entry.id,entry.kind,entry.type,entry.author??'',(entry.title+' '+entry.description).normalize('NFKC').toLowerCase(),JSON.stringify(publishedMetadata(entry)),entry.indexable?1:0,...sorts.map(sort=>orders.get(sort)!.get(entry.id)!));
  })();loaded.set(db,release);matched.delete(db);
}
/** Query only metadata and the requested result page; content bodies remain lazy. */
export function queryPublicCatalog(db:Database.Database,release:Release,input:ContentQuery,search=false){
  const page=input.page??1,pageSize=input.pageSize??24;paginate([],page,pageSize);validateQueryFields(input,release.types);
  const orders:Record<string,string>={title:'sort_title','-title':'sort_title_desc',updatedAt:'sort_updated','-updatedAt':'sort_updated_desc',publishedAt:'sort_published','-publishedAt':'sort_date',date:'sort_date',oldest:'sort_oldest'};
  if(input.sort&&!orders[input.sort])throw new WeavaError('排序方式无效。');
  catalog(db,release);
  const clauses:string[]=[],args:any[]=[];
  const eq=(clause:string,value:any)=>{clauses.push(clause);args.push(value);};
  const kind=input.kind??(search?undefined:'content');if(kind)eq('c.kind=?',kind);if(input.type)eq('c.type=?',input.type);if(input.author)eq('c.author=?',input.author);
  for(const [key,kind,value] of [['categories','category',input.category],['tags','tag',input.tag]] as const)if(value){
    const ids=[value,...taxonomyIds(release.terms??[],kind,value)];
    clauses.push(`(EXISTS(SELECT 1 FROM json_each(c.metadata,?) WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(c.metadata,?) WHERE value IN (${ids.map(()=>'?').join(',')})))`);args.push('$.'+key,value,'$.termIds.'+key,...ids);
  }
  for(const [key,value] of Object.entries(input.fields??{})){
    clauses.push(`EXISTS(SELECT 1 FROM json_each(c.metadata,?) WHERE CASE type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END=?)`);args.push('$.fields.'+JSON.stringify(key),String(value));
  }
  if(search&&input.query?.trim()){
    const terms=tokens(input.query).split(' ').filter(Boolean);
    if(!terms.length)return {items:[] as PublishedEntry[],page,pageSize,total:0,pages:0};
    const match=terms.map(term=>'"'+term.replaceAll('"','')+'"').join(' AND ');
    if(release.entries.length<=8192){
      const old=matched.get(db);
      if(old?.release!==release||old.query!==match){
        db.transaction(()=>{db.exec('CREATE TEMP TABLE IF NOT EXISTS weava_public_matches(id TEXT PRIMARY KEY);DELETE FROM weava_public_matches;');
          db.prepare('INSERT OR IGNORE INTO weava_public_matches SELECT m.entry_id FROM publication_fts f JOIN publication_members m ON m.object_key=f.object_key WHERE publication_fts MATCH ? AND m.release_id=?').run(match,release.id);})();
        matched.set(db,{release,query:match});
      }
      clauses.push('c.indexable=1 AND c.id IN (SELECT id FROM weava_public_matches)');
    }else{
      clauses.push('c.indexable=1 AND c.id IN (SELECT m.entry_id FROM publication_fts f JOIN publication_members m ON m.object_key=f.object_key WHERE publication_fts MATCH ? AND m.release_id=?)');args.push(match,release.id);
    }
  }else if(!search&&input.query)eq('instr(c.search,?)>0',input.query.normalize('NFKC').toLowerCase());
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=(db.prepare('SELECT COUNT(*) n FROM weava_public_catalog c'+where).get(...args) as {n:number}).n;
  const rows=db.prepare('SELECT c.id FROM weava_public_catalog c'+where+' ORDER BY c.'+orders[input.sort??'date']+' LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize) as {id:string}[];
  const entries=releaseIndex(release).byId;return {items:rows.map(row=>entries.get(row.id)!),page,pageSize,total,pages:Math.ceil(total/pageSize)};
}
