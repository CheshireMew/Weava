import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {siteRoutes} from '../../core/src/site-routes.ts';

/** Read deployment metadata without importing a newer database core or migrating. */
export function publicInventory(root:string){
 const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});
 try{
  const releaseId=db.prepare("SELECT value FROM state WHERE key='release'").get()?.value as string|undefined;
  const row=releaseId?db.prepare('SELECT data FROM releases WHERE id=?').get(releaseId):undefined;
  const raw=row?JSON.parse(String(row.data)):null;
  const object=(key:string)=>{const row=db.prepare('SELECT data FROM publication_objects WHERE key=?').get(key);if(!row)throw new Error('公开版本引用的数据不存在。');return JSON.parse(String(row.data));};
  const settings=raw?(raw.storageVersion===2?object(raw.settingsKey):raw.settings):JSON.parse(String(db.prepare("SELECT data FROM records WHERE scope='settings' AND id='site'").get()?.data??'{}'));
  let entries:any[]=raw?.entries??[];
  if(raw?.storageVersion===2){
   if(raw.catalogKey)entries=object(raw.catalogKey).map((item:any)=>item.summary);
   else entries=raw.entryKeys.map((key:string)=>JSON.parse(String(db.prepare("SELECT json_remove(data,'$.document','$.blocks','$.html','$.compatibility','$.source') data FROM publication_objects WHERE key=?").get(key)?.data)));
  }
  const redirects=raw?(raw.storageVersion===2?object(raw.redirectsKey):raw.redirects??{}):{};
  const paths=[...new Set([...entries.filter(entry=>entry.visibility!=='private').map(entry=>String(entry.path)),...siteRoutes(root).paths])];
  const domain=String(settings.domain??'http://127.0.0.1');new URL(domain);
  const config=JSON.parse(readFileSync(join(root,'site.json'),'utf8'));
  const dynamicRedirects=Object.fromEntries((config.upgrade?.dynamicRedirects??[]).map((rule:any)=>[new URL(rule.path,domain).pathname,{status:rule.status??302,targets:entries.filter(entry=>entry.visibility!=='private'&&entry.kind==='content'&&entry.type===rule.contentType).map(entry=>new URL(entry.path,domain).href).sort()}]));
  return {releaseId:releaseId??null,domain,paths,redirects:Object.keys(redirects),dynamicRedirects,indexable:entries.filter(entry=>entry.visibility!=='private'&&entry.indexable!==false).map(entry=>String(entry.path))};
 }finally{db.close();}
}

/** Authored data and code invalidate a rehearsal; extension runtime caches do not. */
export function siteStamp(root:string){
 const hash=createHash('sha256'),db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});
 try{
  for(const sql of ["SELECT key,value FROM state WHERE key='release' OR key LIKE 'owner%' ORDER BY key","SELECT scope,COUNT(*) count,MAX(revision) revision FROM records GROUP BY scope ORDER BY scope","SELECT MAX(revision) revision,COUNT(*) count FROM revisions"])
   hash.update(JSON.stringify(db.prepare(sql).all()));
 }finally{db.close();}
 const business=join(root,'business.sqlite');
 if(existsSync(business)){const db=new DatabaseSync(business,{readOnly:true});try{for(const name of ['website_data','website_migrations'])for(const row of db.prepare('SELECT * FROM '+name+' ORDER BY 1,2').iterate())hash.update(JSON.stringify(row));}finally{db.close();}}
 for(const name of ['site.json','program.json','cli-token'])if(existsSync(join(root,name)))hash.update(readFileSync(join(root,name)));
 for(const folder of ['extensions','themes','imports']){
  const visit=(base:string,relative='')=>{if(!existsSync(base))return;for(const name of readdirSync(base).sort()){const file=join(base,name),key=(relative+'/'+name).replaceAll('\\','/'),stat=lstatSync(file);if(stat.isSymbolicLink()||folder==='extensions'&&(key==='/state'||key.startsWith('/state/')))continue;if(stat.isDirectory())visit(file,key);else if(folder==='extensions'||/\.(json|css|js|mjs)$/i.test(name))hash.update(key).update(readFileSync(file));}};visit(join(root,folder));
 }
 return hash.digest('hex');
}
