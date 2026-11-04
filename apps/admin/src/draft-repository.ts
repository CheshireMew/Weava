import type { Entry,Revision } from '@weava/contracts';
import { localDrafts,acknowledgeLocalDrafts,latestPendingDraft,matchesDraft,type LocalDraft } from './local-drafts.ts';

export interface DraftRow {id:string;copies:LocalDraft[];bytes:number;updatedAt:number}
export type DraftMeta=Omit<DraftRow,'copies'>;
export interface DraftChange {row?:DraftRow;remove?:string[]}
export interface DraftDatabase {transact(id:string,change:(row:DraftRow|undefined,metadata:DraftMeta[])=>DraftChange):Promise<LocalDraft[]>}
const request=<T>(item:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{item.onsuccess=()=>resolve(item.result);item.onerror=()=>reject(item.error);});
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
  constructor(private database:DraftDatabase,private legacy?:Storage){}
  private execute(id:string,action:(copies:LocalDraft[])=>LocalDraft[],clock=Date.now()){
    const work=this.tail.then(async()=>{
      const old=this.legacy?localDrafts(id,this.legacy):[];
      const result=await this.database.transact(id,(stored,metadata)=>{
        const copies=latestPendingDraft(action(latestPendingDraft([...old,...(stored?.copies??[])]))),size=bytes(copies);
        const maximum=3*1024*1024;
        if(size>maximum)throw new Error('这份草稿过大，浏览器无法保留副本；请保持页面打开并保存到网站。');
        const others=metadata.filter(row=>row.id!==id).sort((a,b)=>a.updatedAt-b.updatedAt),remove:string[]=[];
        let total=size+others.reduce((sum,row)=>sum+row.bytes,0),count=others.length+Number(copies.length>0);
        for(const row of others){if(total<=maximum&&count<=40)break;remove.push(row.id);total-=row.bytes;count--;}
        if(!copies.length){remove.push(id);return {remove};}
        return {row:{id,copies,bytes:size,updatedAt:Math.max(stored?.updatedAt??0,clock)},remove};
      });
      // The old recovery copy is retired only after the replacement transaction commits.
      if(old.length&&this.legacy)acknowledgeLocalDrafts(old[0].record,this.legacy);
      return result;
    });
    this.tail=work.then(()=>{},()=>{});return work;
  }
  read(id:string){return this.execute(id,copies=>copies);}
  save(record:Revision<Entry>,clock=Date.now()){
    const snapshot=structuredClone(record);
    return this.execute(record.id,()=>[{id:record.id,capturedAt:clock,updatedAt:clock,pending:true,record:snapshot}],clock);
  }
  acknowledge(record:Revision<Entry>){return this.execute(record.id,copies=>copies.filter(copy=>!matchesDraft(copy,record)));}
  forget(id:string){return this.execute(id,()=>[]);}
}
let repository:DraftRepository|undefined;
export function drafts(){
  if(!repository){let legacy:Storage|undefined;try{legacy=localStorage;}catch{}repository=new DraftRepository(new IndexedDraftDatabase(),legacy);}
  return repository;
}
