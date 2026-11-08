export interface EditableRecord {id?:string;revision:number|null;value:any;[key:string]:any}
export interface RecoveryStore {readonly length:number;key(index:number):string|null;getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}

interface Copy<R> {key:string; record:R; time:number}
/** Each snapshot has an immutable key. Another window can never overwrite it. */
export class RecordRecovery<R extends EditableRecord> {
  private owned = new Map<string,string>();
  private clock = 0;
  constructor(private storage:RecoveryStore,private prefix:string,private equal:(a:any,b:any)=>boolean){}
  private identity(row:R){return String(row.id ?? row.value.id ?? 'new');}
  remember(row:R){
    const key=this.prefix+':copy:'+crypto.randomUUID(),id=this.identity(row);
    const time=this.clock=Math.max(Date.now(),this.clock+1);
    this.storage.setItem(key,JSON.stringify({record:row,time}));
    const old=this.owned.get(id);this.owned.set(id,key);
    if(old)this.storage.removeItem(old);
  }
  acknowledge(row:R){
    const id=this.identity(row),key=this.owned.get(id);
    if(!key)return;
    const raw=this.storage.getItem(key),copy=raw?JSON.parse(raw):null;
    if(copy&&this.equal(copy.record.value,row.value)) {this.storage.removeItem(key);this.owned.delete(id);}
  }
  discardOwn(row:R|null){if(!row)return;const id=this.identity(row),key=this.owned.get(id);if(key)this.storage.removeItem(key);this.owned.delete(id);}
  discard(copy:Copy<R>){this.storage.removeItem(copy.key);}
  find(row:R|null,initial=false):Copy<R>|undefined {
    const copies:Copy<R>[]=[];
    for(let index=0;index<this.storage.length;index++){
      const key=this.storage.key(index);if(!key?.startsWith(this.prefix+':')||key===this.prefix+':last')continue;
      const raw=this.storage.getItem(key);if(!raw)continue;
      const data=JSON.parse(raw),record=(key.startsWith(this.prefix+':copy:')?data.record:data) as R;
      if(!record?.value)continue;
      const same=!!row&&this.identity(record)===this.identity(row);
      if((same||initial)&&(!same||!this.equal(record.value,row!.value)))copies.push({key,record,time:data.time??0});
    }
    return copies.sort((a,b)=>Number(!!row&&this.identity(b.record)===this.identity(row))-Number(!!row&&this.identity(a.record)===this.identity(row))||b.time-a.time)[0];
  }
}
