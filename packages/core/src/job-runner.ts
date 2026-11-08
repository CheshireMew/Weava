import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { WeavaError, type Job } from '@weava/contracts';
import type { Site } from './site.ts';
import { TaskService } from './task-service.ts';
import {siteFeatures,operationFeature} from './site-features.ts';
import {digest} from '../../runtime-common/src/identity.ts';
export interface JobRunnerOptions { framework: string; worker?: string; source?: boolean; concurrency?: number; maxQueued?: number; logBytes?: number; startPaused?: boolean; timeoutMs?:number }
export class JobRunner {
  private children = new Map<string,ChildProcess>();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private paused = true;
  private retryAt=0;
  private failures=0;
  private exited=new Map<string,string>();
  pause(value: boolean) { this.paused = value; if(!value&&this.service?.isStopped)this.service=new TaskService(this.site.root,this.options); }
  get pendingQueries() { return this.service.pending; }
  get queryProcessCount() { return this.service.processCount; }
  stopQueries() { this.service.stop(); }
  private concurrency: number;
  private timeoutMs:number;
  private service:TaskService;
  constructor(private site: Site, private options: JobRunnerOptions) {
    this.paused = options.startPaused ?? true;
    this.timeoutMs=options.timeoutMs??Number(process.env.WEAVA_JOB_TIMEOUT_MS??1800000);
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1)throw new WeavaError('任务执行期限必须是正整数毫秒。');
    this.service=new TaskService(site.root,options);
    this.concurrency = Math.max(1,Math.min(4,options.concurrency??2));
    this.timer=setInterval(()=>this.pump(),250); this.timer.unref();
  }
  enqueue(operation: string, payload: any, key?: string): Job {
    const feature=operationFeature(operation);
    if(feature&&!siteFeatures(this.site.root).includes(feature))throw new WeavaError('网站未启用此任务所需功能。',404);
    if (this.stopped) throw new WeavaError('服务正在停止，请稍后重试。',503);
    const job = this.site.store.raw.transaction(()=>{
      if (key) {
        const existing = this.site.store.raw.prepare('SELECT id FROM jobs WHERE idempotency=?').get(key) as {id:string}|undefined;
        if (existing) return this.site.createJob(operation,payload,key);
      }
      const count = this.site.store.raw.prepare("SELECT COUNT(*) n FROM jobs WHERE status='queued'").get() as {n:number};
      if(count.n >= (this.options.maxQueued??128)) throw new WeavaError('待执行任务已满，请等待已有任务完成。',429);
      const created=this.site.createJob(operation,payload,key);
      return this.site.updateJob(created.id,{managed:true});
    }).immediate();
    this.pump(); return this.site.job(job.id);
  }
  pump() {
    if(!this.site.store.raw.open||Date.now()<this.retryAt)return;
    try {this.poll();this.failures=0;this.retryAt=0;}
    catch(error:any){
      this.retryAt=Date.now()+Math.min(5000,100*2**Math.min(this.failures++,6));
      if(!['SQLITE_BUSY','SQLITE_LOCKED'].includes(error.code))console.error('任务调度失败，将重试：',error.message);
    }
  }
  private poll() {
    for(const [id,message] of this.exited){const job=this.site.job(id);if(['queued','running'].includes(job.status))this.site.updateJob(id,{status:'failed',message});this.exited.delete(id);}
    if(this.stopped || this.paused)return;
    // An idle poll is a read, not a write-lock acquisition. SQLite can answer this through jobs_status.
    if(!this.site.store.raw.prepare("SELECT 1 FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 LIMIT 1").get())return;
    for(;;){
      const claimed=this.site.store.raw.transaction(()=>{
        const active=this.site.store.raw.prepare("SELECT COUNT(*) n FROM jobs WHERE status='running'").get() as {n:number};
        if(active.n>=this.concurrency)return null;
        const next=this.site.store.raw.prepare("SELECT id FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 ORDER BY rowid LIMIT 1").get() as {id:string}|undefined;
        return next?this.site.updateJob(next.id,{status:'running',workerPid:process.pid,deadlineAt:Date.now()+this.timeoutMs,message:'正在启动任务'}):null;
      }).immediate();
      if(!claimed)break;
      try{this.launch(claimed);}catch(error:any){this.site.updateJob(claimed.id,{status:'failed',workerPid:undefined,message:error.message});}
    }
  }
  private launch(job: Job) {
    const framework=this.options.framework,worker=this.options.worker??join(framework,'dist','worker.mjs');
    const compiled=!this.options.source&&existsSync(worker);
    const args=['--max-old-space-size=768',...(compiled?[worker]:['--import','tsx',join(framework,'packages/core/src/worker.ts')]),this.site.root,job.id];
    const child=spawn(process.execPath,args,{cwd:framework,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WEAVA_SITE:this.site.root}});
    this.children.set(job.id,child);
    if(child.pid)this.site.updateJob(job.id,{workerPid:child.pid});
    const log=createWriteStream(join(this.site.root,'logs',job.id+'.log'),{flags:'a'});
    let bytes=0,truncated=false;
    const capture=(data:Buffer)=>{
      const maximum=this.options.logBytes??8*1024*1024;
      if(bytes<maximum){const part=data.subarray(0,maximum-bytes);bytes+=part.length;if(!log.write(part)){child.stdout?.pause();child.stderr?.pause();}}
      else if(!truncated){truncated=true;log.write('\n[日志已达到上限，后续输出省略；任务状态及错误仍可查询。]\n');}
    };
    log.on('drain',()=>{child.stdout?.resume();child.stderr?.resume();});
    log.on('error',(error)=>{console.error('Task log failed:',error.message);child.stdout?.resume();child.stderr?.resume();});
    child.stdout!.on('data',capture);child.stderr!.on('data',capture);
    child.once('error',(error)=>{this.exited.set(job.id,error.message);this.pump();});
    child.once('close',(code)=>{
      this.children.delete(job.id);
      if(!this.site.store.raw.open){log.end();return;}
      if(!this.exited.has(job.id))this.exited.set(job.id,'任务进程意外退出：'+code);
      if(truncated)log.write('\n[任务结果请查看任务状态。]\n');
      log.end();this.pump();
    });
  }
  async wait(id: string, timeoutMs=120000) {
    const deadline=Date.now()+timeoutMs;
    for(;;){
      const job=this.site.job(id);
      if(job.status==='complete')return job.result;
      if(!['queued','running'].includes(job.status))throw new WeavaError(job.message,job.errorStatus??400,{jobId:id,cause:job.errorDetails});
      if(Date.now()>deadline)throw new WeavaError('任务仍在执行，可在任务列表继续查看。',503,{jobId:id});
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  query(operation:string,payload:any){
    const feature=operationFeature(operation);
    if(feature&&!siteFeatures(this.site.root).includes(feature))return Promise.reject(new WeavaError('网站未启用此任务所需功能。',404));
    return this.service.run(operation,payload);
  }
  cancel(id:string){return this.site.jobStore.cancelJob(id);}
  command(operation:string,payload:any,key?:string){
    if(key)return this.enqueue(operation,payload,key);
    return this.site.store.raw.transaction(()=>{
      let next='command:'+digest({operation,payload});
      for(;;){
        const found=this.site.store.raw.prepare('SELECT id,status FROM jobs WHERE idempotency=?').get(next) as {id:string;status:string}|undefined;
        if(!found||!['failed','cancelled'].includes(found.status))return this.enqueue(operation,payload,next);
        // These commands commit their content and successful result in one transaction.
        // A terminal failed attempt can be retried; queued/running/successful attempts are reused.
        next='command-retry:'+found.id;
      }
    }).immediate();
  }
  /** Running workers finish independently. Never close their instance leases or kill unrelated processes. */
  stop() {this.stopped=true;clearInterval(this.timer);this.service.stop();}
}
