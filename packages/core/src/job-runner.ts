import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { WeavaError, type Job } from '@weava/contracts';
import type { Site } from './site.ts';
import { TaskService } from './task-service.ts';
import {siteFeatures,operationFeature} from './site-features.ts';
export interface JobRunnerOptions { framework: string; worker?: string; source?: boolean; concurrency?: number; maxQueued?: number; logBytes?: number; startPaused?: boolean }
export class JobRunner {
  private children = new Map<string,ChildProcess>();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private paused = true;
  pause(value: boolean) { this.paused = value; if(!value&&this.service?.isStopped)this.service=new TaskService(this.site.root,this.options); }
  get pendingQueries() { return this.service.pending; }
  get queryProcessCount() { return this.service.processCount; }
  stopQueries() { this.service.stop(); }
  private concurrency: number;
  private service:TaskService;
  constructor(private site: Site, private options: JobRunnerOptions) {
    this.paused = options.startPaused ?? true;
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
    if(this.stopped || this.paused)return;
    // An idle poll is a read, not a write-lock acquisition. SQLite can answer this through jobs_status.
    if(!this.site.store.raw.prepare("SELECT 1 FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 LIMIT 1").get())return;
    for(;;){
      const claimed=this.site.store.raw.transaction(()=>{
        const active=this.site.store.raw.prepare("SELECT COUNT(*) n FROM jobs WHERE status='running'").get() as {n:number};
        if(active.n>=this.concurrency)return null;
        const next=this.site.store.raw.prepare("SELECT id FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 ORDER BY rowid LIMIT 1").get() as {id:string}|undefined;
        return next?this.site.updateJob(next.id,{status:'running',workerPid:process.pid,message:'正在启动任务'}):null;
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
    child.once('error',(error)=>{this.site.updateJob(job.id,{status:'failed',message:error.message});});
    child.once('close',(code)=>{
      this.children.delete(job.id);
      if(!this.site.store.raw.open){log.end();return;}
      const current=this.site.job(job.id);
      if(['queued','running'].includes(current.status))this.site.updateJob(job.id,{status:'failed',message:'任务进程意外退出：'+code});
      if(truncated)log.write('\n'+this.site.job(job.id).message+'\n');
      log.end();if(!this.stopped)this.pump();
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
  /** Running workers finish independently. Never close their instance leases or kill unrelated processes. */
  stop() {this.stopped=true;clearInterval(this.timer);this.service.stop();}
}
