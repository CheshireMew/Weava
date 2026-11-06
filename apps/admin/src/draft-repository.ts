import type { Entry,Revision } from '@weava/contracts';
import { localDrafts,allLocalDrafts,acknowledgeLocalDrafts,latestPendingDraft,matchesDraft,type LocalDraft } from './local-drafts.ts';

export interface DraftRow {id:string;copies:LocalDraft[];bytes:number;updatedAt:number}
export type DraftMeta=Omit<DraftRow,'copies'>;
export interface DraftChange {row?:DraftRow;remove?:string[]}
export interface DraftDatabase {read(id:string):Promise<DraftRow|undefined>;readAll():Promise<DraftRow[]>;transact(id:string,change:(row:DraftRow|undefined,metadata:DraftMeta[])=>DraftChange):Promise<LocalDraft[]>}
const request=<T>(item:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{item.onsuccess=()=>resolve(item.result);item.onerror=()=>reject(item.error);});
let channel:BroadcastChannel|undefined;
function announce(){if(typeof window==='undefined')return;window.dispatchEvent(new Event('weava-drafts-change'));channel?.postMessage('changed');}
export class IndexedDraftDatabase implements DraftDatabase {
  private connection?:Promise<IDBDatabase>;
  private open(){return this.connection??=new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('浏览器无法启用草稿存储，请保存到网站。'));return;}
    const opening=indexedDB.open('weava-authoring',1);
    opening.onupgradeneeded=()=>{opening.result.createObjectStore('drafts',{keyPath:'id'});opening.result.createObjectStore('metadata',{keyPath:'id'});};
    opening.onsuccess=()=>{opening.result.onversionchange=()=>{opening.result.close();this.connection=undefined;};resolve(opening.result);};
    opening.onerror=()=>{this.connection=undefined;reject(opening.error);};
    opening.onblocked=()=>reject(new Error('请关闭旧的编辑窗口后重试本地草稿。'));
  });}
  async transact(id:string,change:(row:DraftRow|undefined,metadata:DraftMeta[])=>DraftChange){
    const db=await this.open(),tx=db.transaction(['drafts','metadata'],'readwrite'),drafts=tx.objectStore('drafts'),metadata=tx.objectStore('metadata');
    const complete=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('草稿存储未完成。'));tx.onerror=()=>{};});
    try{
      const [row,all]=await Promise.all([request<DraftRow|undefined>(drafts.get(id)),request<DraftMeta[]>(metadata.getAll())]);
      const changes=change(row,all);
      for(const key of changes.remove??[]){drafts.delete(key);metadata.delete(key);}
      if(changes.row){const {copies,...info}=changes.row;drafts.put(changes.row);metadata.put(info);}
      await complete;return changes.row?.copies??((changes.remove??[]).includes(id)?[]:row?.copies??[]);
    }catch(error){try{tx.abort();}catch{}await complete.catch(()=>{});throw error;}
  }
  async read(id:string){const db=await this.open();return request<DraftRow|undefined>(db.transaction('drafts','readonly').objectStore('drafts').get(id));}
  async readAll(){const db=await this.open();return request<DraftRow[]>(db.transaction('drafts','readonly').objectStore('drafts').getAll());}
}
/** Bound by authored data, without stringify or rewriting unrelated articles. */
function bytes(value:any):number{
  if(typeof value==='string')return value.length*2+4;
  if(Array.isArray(value))return 16+value.reduce((sum,item)=>sum+bytes(item),0);
  if(value&&typeof value==='object')return 16+Object.entries(value).reduce((sum,[key,item])=>sum+key.length*2+bytes(item),0);
  return 16;
}
export class DraftRepository {
  private tail=Promise.resolve();
  private capturedAt=0;
  constructor(private database:DraftDatabase,private legacy?:Storage,readonly sessionId:string=crypto.randomUUID()){}
  private execute(id:string,action:(copies:LocalDraft[])=>LocalDraft[],clock=Date.now(),notify=false){
    const work=this.tail.then(async()=>{
      const old=this.legacy?localDrafts(id,this.legacy):[];
      const result=await this.database.transact(id,(stored,metadata)=>{
        const copies=latestPendingDraft(action(latestPendingDraft([...old,...(stored?.copies??[])]))),size=bytes(copies);
        const maximum=3*1024*1024;
        if(size>maximum)throw new Error('这份草稿过大，浏览器无法保留副本；请保持页面打开并保存到网站。');
        const others=metadata.filter(row=>row.id!==id),remove:string[]=[];
        let total=size+others.reduce((sum,row)=>sum+row.bytes,0),count=others.length+Number(copies.length>0);
        if(total>maximum||count>40||copies.length>80)throw new Error('本地未保存草稿已达容量上限，请先保存或明确放弃其它草稿。');
        if(!copies.length){remove.push(id);return {remove};}
        return {row:{id,copies,bytes:size,updatedAt:Math.max(stored?.updatedAt??0,clock)},remove};
      });
      // The old recovery copy is retired only after the replacement transaction commits.
      if(this.legacy)for(const copy of old)acknowledgeLocalDrafts(copy.record,this.legacy,copy.sessionId??'legacy');
      if(notify)announce();
      return result;
    });
    this.tail=work.then(()=>{},()=>{});return work;
  }
  async read(id:string){await this.tail;if(this.legacy&&localDrafts(id,this.legacy).length)return this.execute(id,copies=>copies);return latestPendingDraft((await this.database.read(id))?.copies??[]);}
  async list(){
    await this.tail;
    // Compatibility migration is a write; ordinary reads remain one readonly batch.
    const legacy=this.legacy?allLocalDrafts(this.legacy):[];
    for(const id of new Set(legacy.map(copy=>copy.record.id)))await this.execute(id,copies=>copies);
    const copies=(await this.database.readAll()).flatMap(row=>row.copies);
    const grouped=new Map<string,LocalDraft[]>();
    for(const copy of copies){const id=copy.record.id;grouped.set(id,[...(grouped.get(id)??[]),copy]);}
    return [...grouped.values()].flatMap(latestPendingDraft);
  }
  save(record:Revision<Entry>,clock=Date.now()){
    const snapshot=structuredClone(record);
    clock=this.capturedAt=Math.max(clock,this.capturedAt+1);
    return this.execute(record.id,copies=>latestPendingDraft([{id:record.id,sessionId:this.sessionId,capturedAt:clock,updatedAt:clock,pending:true,record:snapshot},...copies]),clock,true);
  }
  acknowledge(record:Revision<Entry>,sessionId=this.sessionId){return this.execute(record.id,copies=>copies.filter(copy=>(copy.sessionId??'legacy')!==sessionId||!matchesDraft(copy,record)),Date.now(),true);}
  forget(id:string){return this.execute(id,copies=>copies.filter(copy=>(copy.sessionId??'legacy')!==this.sessionId),Date.now(),true);}
  discard(copy:LocalDraft){return this.execute(copy.record.id,copies=>copies.filter(item=>(item.sessionId??'legacy')!==(copy.sessionId??'legacy')||item.updatedAt!==copy.updatedAt||!matchesDraft(item,copy.record)),Date.now(),true);}
}
let repository:DraftRepository|undefined;
export function drafts(){
  if(!repository){let legacy:Storage|undefined;try{legacy=localStorage;}catch{}repository=new DraftRepository(new IndexedDraftDatabase(),legacy);
    if(typeof window!=='undefined'&&typeof window.BroadcastChannel==='function'){channel=new window.BroadcastChannel('weava-authoring');channel.onmessage=()=>window.dispatchEvent(new Event('weava-drafts-change'));}
  }
  return repository;
}
