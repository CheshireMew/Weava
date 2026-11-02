import type { JobRunner } from './job-runner.ts';
import { WeavaError } from '@weava/contracts';
/** Coalesce report reads; keep a bounded, short-lived result cache outside the request CPU path. */
export class TaskResults {
  private cache=new Map<string,{expires:number;value:Promise<any>;pending:boolean}>();
  constructor(private runner:JobRunner,private ttl=10000,private maximum=16){}
  async read(operation:string,payload:any){
    const key=operation+':'+JSON.stringify(payload),old=this.cache.get(key);
    if(old&&(old.pending||old.expires>Date.now()))return old.value;
    for(const [key,item]of this.cache)if(!item.pending&&item.expires<=Date.now())this.cache.delete(key);
    while(this.cache.size>=this.maximum){const disposable=[...this.cache].find(([,item])=>!item.pending);if(!disposable)throw new WeavaError('报表请求较多，请稍后重试。',429);this.cache.delete(disposable[0]);}
    const item={expires:0,pending:true,value:Promise.resolve<any>(null)};
    item.value=this.runner.wait(this.runner.enqueue(operation,payload).id).then(result=>{item.pending=false;item.expires=Date.now()+this.ttl;return result;},error=>{this.cache.delete(key);throw error;});
    this.cache.set(key,item);return item.value;
  }
}
