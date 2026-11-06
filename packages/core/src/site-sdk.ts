import {AsyncLocalStorage} from 'node:async_hooks';
import Database from 'better-sqlite3';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import type {Site} from './site.ts';
import {queryPublished,queryEntries} from './query.ts';
import {renderDocument} from './documents.ts';
import {pageMetadata,metadataHead} from './seo.ts';
import {imageAttributes} from './media.ts';
import {inside} from '../../runtime-common/src/paths.ts';
import {readonlyView} from './readonly-view.ts';
export interface WebsiteContext{
  id:string;root:string;preview:boolean;entry?:any;settings:any;
  request:{url:URL;method:string;owner:boolean};
  resources:{path(relative:string):string};
  content:{get(id:string):any;query(query?:any):any;render(document:any):string};
  media:{url(id:string):string|null};
  seo:{head(entry?:any,url?:URL):string};
  business:{get(collection:string,id:string):any;list(collection:string):any[];put(collection:string,id:string,value:unknown):void;transaction<T>(fn:()=>T):T};
  tasks:{enqueue(operation:string,payload:any,key?:string):any;get?(id:string):any;log?(id:string,offset?:number):any};
}
const key=Symbol.for('weava.website.context');
const globals=globalThis as any;
const scope:AsyncLocalStorage<WebsiteContext>=globals[key]??=(new AsyncLocalStorage<WebsiteContext>());
export function getWebsite():WebsiteContext{const value=scope.getStore();if(!value)throw new Error('getWebsite 只能在网站请求或已绑定的网站任务中使用。');return value;}
export function withWebsite<T>(value:WebsiteContext,fn:()=>T):T{return scope.run(value,fn);}
export class BusinessStore{
 private db:Database.Database;
 constructor(root:string,mode:'open'|'migrate'='open'){
  const file=join(root,'business.sqlite');
  if(!existsSync(file)&&mode!=='migrate')throw new Error('业务数据尚未初始化，请执行 site update。');
  this.db=new Database(file);this.db.pragma('journal_mode=WAL');this.db.pragma('busy_timeout=5000');
  if(mode==='migrate')this.db.exec('CREATE TABLE IF NOT EXISTS website_data(collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(collection,id));CREATE TABLE IF NOT EXISTS website_migrations(id TEXT PRIMARY KEY,version INTEGER NOT NULL);');
 }
 get(collection:string,id:string){const row=this.db.prepare('SELECT data FROM website_data WHERE collection=? AND id=?').get(collection,id) as any;return row?JSON.parse(row.data):null;}
 list(collection:string){return (this.db.prepare('SELECT id,data FROM website_data WHERE collection=? ORDER BY id').all(collection) as any[]).map(r=>({id:r.id,value:JSON.parse(r.data)}));}
 put(collection:string,id:string,value:unknown){if(!collection||!id)throw new Error('业务记录需要集合和编号。');this.db.prepare('INSERT INTO website_data VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(collection,id,JSON.stringify(value));}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn)();}
 version(id:string){return (this.db.prepare('SELECT version FROM website_migrations WHERE id=?').get(id) as any)?.version??0;}
 migrate(id:string,version:number,up:()=>void){
  const before=this.version(id);
  if(before>version)throw new Error('网站业务数据版本比代码新。');
  if(before===version)return;
  if(version!==before+1)throw new Error('业务迁移必须连续。');
  this.db.transaction(()=>{up();this.db.prepare('INSERT INTO website_migrations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(id,version);})();
 }
 close(){this.db.close();}
}
export function websiteContext(site:Site,business:BusinessStore,tasks:WebsiteContext['tasks'],request:Request,preview=false,entry?:any,readOnly=false):WebsiteContext{
 const release=site.visibleRelease(false),settings=preview?site.settings().value:release?.settings??site.settings().value;
 return {id:process.env.WEAVA_SITE_ID??'site',root:site.root,preview,entry:readonlyView(entry),settings:readonlyView(settings),
  request:{url:new URL(request.url),method:request.method,owner:site.authenticate(/(?:^|;\s*)weava-session=([^;]+)/.exec(request.headers.get('cookie')??'')?.[1]??'')},
  resources:{path:relative=>inside(process.env.WEAVA_RESOURCE_ROOT??site.root,relative)},
  content:{get:id=>readonlyView(entry?.id===id?entry:release?.entries.find(e=>e.id===id&&e.visibility!=='private')??null),
   query:q=>readonlyView(preview&&entry?queryEntries([...(release?.entries??[]).filter(e=>e.id!==entry.id),entry],q??{},release?.types,release?.terms):release?queryPublished(site,q??{},false,release.id):queryEntries([],q??{})),render:renderDocument},
  media:{url:id=>site.store.get('media',id)?.value.url??null},
  seo:{head:(value=entry,url=new URL(request.url))=>{if(!release)return '';const meta=pageMetadata(value,release,url,{preview});return metadataHead({...meta,icon:imageAttributes(site,meta.icon??'',64).src});}},
  business:{get:business.get.bind(business),list:business.list.bind(business),put:preview||readOnly?()=>{throw new Error('预览或升级检查不能写入业务数据。');}:business.put.bind(business),transaction:preview||readOnly?fn=>{throw new Error('预览或升级检查不能执行业务事务。');}:business.transaction.bind(business)},
  tasks:{...tasks,enqueue:(operation,payload,key)=>{if(preview||readOnly)throw new Error('预览或升级检查不执行持久任务。');return tasks.enqueue('website:'+operation,payload,key);}}};
}
export const sdkVersion=1;

