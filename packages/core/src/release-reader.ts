import type Database from 'better-sqlite3';
import type { Release, PublishedEntry } from '@weava/contracts';
import { BoundedCache } from './cache.ts';
const details = new WeakMap<object,{key:string;summary:any;hasBlocks:boolean}>();
const caches = new WeakMap<Database.Database,BoundedCache<string,any>>();
export function publishedObjectKey(entry:object){return details.get(entry)?.key;}
export function publishedMetadata(entry:PublishedEntry):Omit<PublishedEntry,'document'|'blocks'|'html'|'compatibility'|'source'>{
  const known=details.get(entry);if(known)return known.summary;
  return Object.fromEntries(Object.keys(entry).filter(key=>!['document','blocks','html','compatibility','source'].includes(key)).map(key=>[key,(entry as any)[key]])) as any;
}
export function publishedHasBlocks(entry:PublishedEntry){return details.get(entry)?.hasBlocks??!!entry.blocks?.length;}
export function loadRelease(db: Database.Database, raw: string): Release {
  const data = JSON.parse(raw);
  if (data.storageVersion !== 2) return data as Release;
  const read = db.prepare('SELECT data FROM publication_objects WHERE key=?');
  let cache=caches.get(db);if(!cache){cache=new BoundedCache(4096,32*1024*1024);caches.set(db,cache);}
  const get = (key: string) => {
    const cached=cache.get(key);if(cached)return cached;
    const row = read.get(key) as { data: string } | undefined;
    if (!row) throw new Error('公开版本引用的数据不存在：' + key);
    return cache.set(key,JSON.parse(row.data),row.data.length*2+256);
  };
  let catalog:{key:string;summary:any;hasBlocks:boolean}[];
  if(data.catalogKey)catalog=get(data.catalogKey);
  else{
    const summaries=new Map<string,{key:string;summary:any;hasBlocks:boolean}>();
    for(let offset=0;offset<data.entryKeys.length;offset+=200){
      const keys=data.entryKeys.slice(offset,offset+200);
      for(const row of db.prepare(`SELECT key,json_remove(data,'$.document','$.blocks','$.html','$.compatibility','$.source') summary,COALESCE(json_array_length(data,'$.blocks'),0) blocks FROM publication_objects WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys) as {key:string;summary:string;blocks:number}[])summaries.set(row.key,{key:row.key,summary:JSON.parse(row.summary),hasBlocks:row.blocks>0});
    }
    catalog=data.entryKeys.map((key:string)=>{const row=summaries.get(key);if(!row)throw new Error('公开版本引用的数据不存在：'+key);return row;});
  }
  const entries=catalog.map(item=>{
    const entry={...item.summary};
    for(const key of ['document','blocks','html','compatibility','source'])Object.defineProperty(entry,key,{enumerable:true,get:()=>get(item.key)[key]});
    details.set(entry,item);return entry as PublishedEntry;
  });
  return {
    id: data.id,
    createdAt: data.createdAt,
    label: data.label,
    entries,
    settings: get(data.settingsKey),
    types: get(data.typesKey),
    redirects: get(data.redirectsKey),
    terms: data.termsKey ? get(data.termsKey) : [],
    ...(data.layoutsKey ? { layouts: get(data.layoutsKey) } : {}),
  };
}
