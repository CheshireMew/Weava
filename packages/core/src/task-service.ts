import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { WeavaError } from '@weava/contracts';
import type { JobRunnerOptions } from './job-runner.ts';

interface Request { id: number; operation: string; payload: any; resolve: (value:any)=>void; reject: (error:Error)=>void }
interface Worker { child: ChildProcess; ready: boolean; request?: Request; timer?: ReturnType<typeof setTimeout> }
/** Bounded IPC workers for reads/preparation. These requests do not create permanent jobs or log files. */
export class TaskService {
  private workers = new Set<Worker>();
  private queue: Request[] = [];
  private next = 0;
  private stopped = false;
  get isStopped() { return this.stopped; }
  get pending() { return this.queue.length + [...this.workers].filter(worker=>worker.request).length; }
  get processCount() { return this.workers.size; }
  constructor(private root: string, private options: JobRunnerOptions) {}
  run(operation: string, payload: any): Promise<any> {
    if (this.stopped) return Promise.reject(new WeavaError('服务正在停止。',503));
    if (this.queue.length >= 32) return Promise.reject(new WeavaError('计算请求较多，请稍后重试。',429));
    return new Promise((resolve,reject)=>{ this.queue.push({id:++this.next,operation,payload,resolve,reject}); this.pump(); });
  }
  private pump() {
    if(this.stopped)return;
    const maximum=Math.max(1,Math.min(2,this.options.concurrency??2));
    for(const worker of this.workers) if(worker.ready&&!worker.request&&this.queue.length)this.dispatch(worker,this.queue.shift()!);
    while(this.queue.length>[...this.workers].filter(worker=>!worker.ready).length&&this.workers.size<maximum)this.launch();
  }
  private launch() {
    const file=this.options.worker??join(this.options.framework,'dist','worker.mjs');
    const queryFile=join(dirname(file),'query-worker.mjs');
    const compiled=!this.options.source&&existsSync(queryFile);
    const args=['--max-old-space-size=768',...(compiled?[queryFile]:['--import','tsx',join(this.options.framework,'packages/core/src/query-worker.ts')]),this.root];
    const child=spawn(process.execPath,args,{cwd:this.options.framework,windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,WEAVA_SITE:this.root}});
    const worker:Worker={child,ready:false};this.workers.add(worker);
    let errorText=''; child.stderr?.on('data',bytes=>{errorText=(errorText+String(bytes)).slice(-8192);});
    worker.timer=setTimeout(()=>{child.kill();},15000);
    child.on('message',(message:any)=>{
      if(message?.type==='ready'){clearTimeout(worker.timer);worker.ready=true;this.pump();return;}
      if(message?.type!=='result'||worker.request?.id!==message.id)return;
      clearTimeout(worker.timer);const request=worker.request!;worker.request=undefined;
      if(message.error)request.reject(new WeavaError(message.error.message,message.error.status??500,message.error.details));else request.resolve(message.value);
      this.pump();
    });
    child.on('error',error=>{errorText=error.message;});
    child.once('close',code=>{
      clearTimeout(worker.timer);this.workers.delete(worker);
      worker.request?.reject(new WeavaError('计算进程退出，请重试。'+(errorText?' '+errorText.slice(-1000):' ('+code+')'),503));
      // If startup failed, reject the bounded waiting group instead of spawning forever.
      if(!worker.ready)for(const request of this.queue.splice(0))request.reject(new WeavaError('计算进程无法启动。'+errorText.slice(-1000),503));
      this.pump();
    });
  }
  private dispatch(worker:Worker,request:Request){
    worker.request=request;
    worker.timer=setTimeout(()=>{worker.child.kill();},120000);
    worker.child.send({type:'run',id:request.id,operation:request.operation,payload:request.payload},error=>{if(error)worker.child.kill();});
  }
  stop(){
    this.stopped=true;
    for(const request of this.queue.splice(0))request.reject(new WeavaError('服务正在停止。',503));
    for(const worker of this.workers){clearTimeout(worker.timer);if(worker.child.connected)worker.child.send({type:'stop'},()=>{});}
  }
}
