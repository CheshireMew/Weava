import type Database from 'better-sqlite3';
import {WeavaError} from '@weava/contracts';
import {uuid,now} from '../../runtime-common/src/identity.ts';
import type {Site} from './site.ts';
export interface SiteEvent {seq:number;id:string;type:string;createdAt:string;data:Record<string,unknown>}
export function appendSiteEvent(db:Database.Database,type:string,data:Record<string,unknown>,id:string=uuid()){
  db.prepare('INSERT OR IGNORE INTO site_events(id,type,created_at,data) VALUES(?,?,?,?)').run(id,type,now(),JSON.stringify(data));
}
export function readSiteEvents(db:Database.Database,after=0,limit=100,types:string[]=[]):SiteEvent[]{
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100||types.length>30)throw new WeavaError('事件读取范围无效。');
  return (db.prepare('SELECT seq,id,type,created_at createdAt,data FROM site_events WHERE seq>?'+(types.length?' AND type IN ('+types.map(()=>'?').join(',')+')':'')+' ORDER BY seq LIMIT ?').all(after,...types,limit) as {seq:number;id:string;type:string;createdAt:string;data:string}[]).map(row=>({...row,data:JSON.parse(row.data)}));
}
export function registerEventConsumer(db:Database.Database,id:string,after:number,types:string[]=[]){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw new WeavaError('消费方名称只接受字母、数字、下划线和短横线。');
  readSiteEvents(db,after,1,types);
  const previous=db.prepare('SELECT id FROM event_consumers WHERE id=?').get(id);
  if(previous)throw new WeavaError('消费方已存在，未重置读取位置。',409);
  db.prepare('INSERT INTO event_consumers(id,cursor,types) VALUES(?,?,?)').run(id,after,JSON.stringify(types));
  return {id,cursor:after};
}
interface Consumer {id:string;cursor:number;types:string;token:string|null;until:number;batch_to:number;attempts:number;retry_at:number;error:string}
function consumer(db:Database.Database,id:string){const row=db.prepare('SELECT * FROM event_consumers WHERE id=?').get(id) as Consumer|undefined;if(!row)throw new WeavaError('事件消费方不存在。',404);return row;}
export function eventConsumers(db:Database.Database){return (db.prepare('SELECT * FROM event_consumers ORDER BY id').all() as Consumer[]).map(row=>({id:row.id,cursor:row.cursor,types:JSON.parse(row.types) as string[],attempts:row.attempts,retryAt:row.retry_at,leaseUntil:row.until,error:row.error,failed:row.attempts>=10}));}
export function claimSiteEvents(db:Database.Database,id:string,clock=Date.now()){
  return db.transaction(()=>{
    const row=consumer(db,id);
    if(row.token&&row.until>clock)throw new WeavaError('已有事件批次正在处理。',409,{leaseUntil:row.until});
    if(row.attempts>=10)throw new WeavaError('这批事件已失败十次，请检查后显式重试。',409);
    if(row.retry_at>clock)throw new WeavaError('正在等待重试。',429,{retryAt:row.retry_at});
    const events=readSiteEvents(db,row.cursor,100,JSON.parse(row.types));
    if(!events.length)return {token:null,leaseUntil:0,events,cursor:row.cursor};
    const token=uuid(),until=clock+120000;
    db.prepare('UPDATE event_consumers SET token=?,until=?,batch_to=?,attempts=attempts+1 WHERE id=?').run(token,until,events.at(-1)!.seq,id);
    return {token,leaseUntil:until,events,cursor:row.cursor};
  }).immediate();
}
export function finishSiteEvents(db:Database.Database,id:string,token:string,error?:string,clock=Date.now()){
  return db.transaction(()=>{
    const row=consumer(db,id);
    if(row.token!==token||!token||row.until<clock)throw new WeavaError('事件租约已过期或已被其它调用接手，请重新读取。',409);
    if(error)db.prepare('UPDATE event_consumers SET token=NULL,until=0,retry_at=?,error=? WHERE id=?').run(clock+Math.min(3600000,1000*2**row.attempts),error.slice(0,2000),id);
    else db.prepare("UPDATE event_consumers SET cursor=batch_to,token=NULL,until=0,attempts=0,retry_at=0,error='' WHERE id=?").run(id);
    return {id,cursor:error?row.cursor:row.batch_to};
  }).immediate();
}
export function retrySiteEvents(db:Database.Database,id:string,clock=Date.now()){
  return db.transaction(()=>{const row=consumer(db,id);if(row.token&&row.until>clock)throw new WeavaError('事件批次仍在处理，未抢占有效租约。',409);db.prepare("UPDATE event_consumers SET token=NULL,until=0,attempts=0,retry_at=0,error='' WHERE id=?").run(id);return {id,cursor:row.cursor};}).immediate();
}
export class EventQueue {
  constructor(private site:Pick<Site,'store'>){}
  read(after=0,limit=100,types:string[]=[]){return readSiteEvents(this.site.store.raw,after,limit,types);}
  consumers(){return eventConsumers(this.site.store.raw);}
  register(id:string,after:number,types:string[]=[]){return registerEventConsumer(this.site.store.raw,id,after,types);}
  claim(id:string){return claimSiteEvents(this.site.store.raw,id);}
  finish(id:string,token:string,error?:string){return finishSiteEvents(this.site.store.raw,id,token,error);}
  retry(id:string){return retrySiteEvents(this.site.store.raw,id);}
}
