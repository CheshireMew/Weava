import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { WeavaError, type Job } from '@weava/contracts';
import type { Site } from './site.ts';
import { TaskService } from './task-service.ts';
import {siteFeatures,operationFeature} from './site-features.ts';
import {digest} from '../../runtime-common/src/identity.ts';
import {updateMediaOptimization} from './media.ts';
import {nextPublicationTime} from './publication-time.ts';
import {queueScheduledPublications} from './schedules.ts';
export interface JobRunnerOptions { framework: string; worker?: string; source?: boolean; concurrency?: number; maxQueued?: number; logBytes?: number; startPaused?: boolean; timeoutMs?:number;schedulePublications?:boolean }
const publicationCommands=['publish','withdraw','entry-delete'];
const backgroundCommands=['media-optimize','preflight-wxr','import-wxr','import-source','backup','verify','import-json','archive-history','restore-history','media','seo-audit','storage-scan','markdown-export','markdown-preview','markdown-import','analytics-archive','analytics-restore'];
export class JobRunner {
  private children = new Map<string,ChildProcess>();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private paused = true;
  private retryAt=0;
  private failures=0;
  private exited=new Map<string,string>();
  private dueTimer?:ReturnType<typeof setTimeout>;
  private dueAt:number|null=null;
  private lastDueAttempt=0;
  private administrationWarm=false;
  private backgroundWarm?:Promise<unknown>;
  pause(value: boolean) { this.paused = value; if(!value&&this.service?.isStopped)this.service=new TaskService(this.site.root,this.options); if(!value&&this.background?.isStopped)this.background=new TaskService(this.site.root,this.options,1);if(!value&&this.publication?.isStopped)this.publication=new TaskService(this.site.root,this.options,1);this.refreshSchedule(); }
  refreshSchedule(){
    if(!this.options.schedulePublications||this.stopped||this.paused||!this.site.store.raw.open){clearTimeout(this.dueTimer);this.dueTimer=undefined;this.dueAt=null;return;}
    const due=nextPublicationTime(this.site.store);
    if(this.dueTimer&&due===this.dueAt)return;
    clearTimeout(this.dueTimer);this.dueTimer=undefined;this.dueAt=due;
    if(due===null||this.site.activeJobs().some(job=>publicationCommands.includes(job.operation)))return;
    const delay=Math.min(2147483647,Math.max(0,due-Date.now(),this.lastDueAttempt+1000-Date.now()));
    this.dueTimer=setTimeout(()=>{
      this.dueTimer=undefined;
      if(this.stopped||this.paused||!this.site.store.raw.open)return;
      if(due>Date.now()){this.refreshSchedule();return;}
      this.lastDueAttempt=Date.now();
      try{queueScheduledPublications(this.site,this);}catch(error){console.error('定时发布检查失败',error);}
      this.refreshSchedule();
    },delay);this.dueTimer.unref();
  }
  get pendingQueries() { return this.service.pending + this.background.pending + this.publication.pending; }
  get queryProcessCount() { return this.service.processCount + this.background.processCount + this.publication.processCount; }
  stopQueries() { this.service.stop(); this.background.stop();this.publication.stop(); }
  private concurrency: number;
  private timeoutMs:number;
  private service:TaskService;
  private background:TaskService;
  private publication:TaskService;
  constructor(private site: Site, private options: JobRunnerOptions) {
    this.paused = options.startPaused ?? true;
    this.timeoutMs=options.timeoutMs??Number(process.env.WEAVA_JOB_TIMEOUT_MS??1800000);
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1)throw new WeavaError('任务执行期限必须是正整数毫秒。');
    this.service=new TaskService(site.root,options);
    this.background=new TaskService(site.root,options,1);
    this.publication=new TaskService(site.root,options,1);
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
    // Commands/import staging can enqueue inside an outer transaction. A reused
    // process may read immediately, so dispatch only after that transaction commits.
    if(this.site.store.raw.inTransaction)queueMicrotask(()=>this.pump());else this.pump();
    return this.site.job(job.id);
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
        const light=['schedule-create','plan-save','media-edit','media-variant'];
        const background=backgroundCommands;
        const running=this.site.activeJobs().filter(job=>job.status==='running');
        const queued=this.site.store.raw.prepare("SELECT id,operation FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 ORDER BY CASE WHEN operation='media-optimize' THEN 2 WHEN operation IN ('schedule-create','plan-save') THEN 0 ELSE 1 END,rowid LIMIT 128").all() as {id:string;operation:string}[];
        const next=queued.find(job=>publicationCommands.includes(job.operation)?!running.some(active=>publicationCommands.includes(active.operation)):background.includes(job.operation)
          ? !running.some(active=>background.includes(active.operation))
          : light.includes(job.operation) ? !running.some(active=>light.includes(active.operation))
          : running.filter(active=>!publicationCommands.includes(active.operation)&&!background.includes(active.operation)&&!light.includes(active.operation)).length<this.concurrency);
        return next?this.site.updateJob(next.id,{status:'running',workerPid:process.pid,deadlineAt:Date.now()+this.timeoutMs,heartbeatAt:Date.now(),message:next.operation==='publish'?'正在提交发布版本':'正在启动任务'}):null;
      }).immediate();
      if(!claimed)break;
      try{
        if(claimed.operation==='publish')this.runPublication(claimed);
        else if(claimed.operation==='media-optimize')this.optimizeImage(claimed);
        else if(['preflight-wxr','import-wxr','import-source'].includes(claimed.operation))this.runImport(claimed);
        else if(['schedule-create','plan-save','media-edit','media-variant'].includes(claimed.operation))this.runCommand(claimed);
        else if(publicationCommands.includes(claimed.operation)||backgroundCommands.includes(claimed.operation))this.runManaged(claimed);
        else this.launch(claimed);
      }catch(error:any){this.site.updateJob(claimed.id,{status:'failed',workerPid:undefined,message:error.message});}
    }
  }
  warmPublication(){return this.publication.run('publication-warm',{});}
  warmBackground(){
    if(this.paused||this.stopped)return Promise.resolve();
    if(this.backgroundWarm&&this.background.processCount)return this.backgroundWarm;
    const work=this.background.run('background-warm',{}).catch(error=>{if(this.backgroundWarm===work)this.backgroundWarm=undefined;throw error;});
    this.backgroundWarm=work;return work;
  }
  warmAdministration(){
    if(this.administrationWarm||this.paused||this.stopped)return;
    this.administrationWarm=true;
    void Promise.all([this.service.run('command-warm',{}),this.warmBackground()])
      .catch(()=>{this.administrationWarm=false;});
  }
  private runManaged(job:Job){
    const service=publicationCommands.includes(job.operation)?this.publication:this.background;
    const heartbeat=setInterval(()=>{if(this.site.store.raw.open&&this.site.job(job.id).status==='running')this.site.updateJob(job.id,{heartbeatAt:Date.now()});},1000);heartbeat.unref();
    void service.run('managed-job',{jobId:job.id,deadlineAt:job.deadlineAt}).then(result=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:'complete',message:'已完成。',result});
    },(error:any)=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:this.site.job(job.id).cancelRequestedAt?'cancelled':'failed',message:error.message,errorStatus:error.status??400,errorDetails:error.details});
    }).finally(()=>{clearInterval(heartbeat);this.pump();this.refreshSchedule();});
  }
  private runPublication(job:Job){
    const heartbeat=setInterval(()=>{if(this.site.store.raw.open&&this.site.job(job.id).status==='running')this.site.updateJob(job.id,{heartbeatAt:Date.now()});},1000);heartbeat.unref();
    void this.publication.run('publication-publish',{...job.payload,jobId:job.id,deadlineAt:job.deadlineAt}).then(result=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:'complete',message:'发布已完成。',result});
    },(error:any)=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:this.site.job(job.id).cancelRequestedAt?'cancelled':'failed',message:this.site.job(job.id).cancelRequestedAt?'任务已取消。':error.message,errorStatus:error.status??400,errorDetails:error.details});
    }).finally(()=>{clearInterval(heartbeat);if(this.site.store.raw.open&&this.site.job(job.id).status==='complete')this.lastDueAttempt=0;this.refreshSchedule();});
  }
  private optimizeImage(job: Job) {
    this.site.updateJob(job.id,{message:'正在优化图片，原图已可使用'});
    void this.background.run('media-optimize',{...job.payload,jobId:job.id}).then(result=>{
      if(this.site.store.raw.open)this.site.updateJob(job.id,{status:'complete',message:'图片优化已完成。',result});
    },(error:any)=>{
      if(this.site.store.raw.open){
        updateMediaOptimization(this.site,job.payload.id,{optimization:{status:'failed',error:error.message}});
        this.site.updateJob(job.id,{status:this.site.job(job.id).cancelRequestedAt?'cancelled':'failed',message:error.message});
      }
    });
  }
  private runCommand(job: Job) {
    void this.service.run('content-command',{operation:job.operation,payload:job.payload,jobId:job.id}).then(result=>{
      if(this.site.store.raw.open)this.site.updateJob(job.id,{status:'complete',message:'已完成。',result});
    },(error:any)=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:this.site.job(job.id).cancelRequestedAt?'cancelled':'failed',message:error.message,errorStatus:error.status??400,errorDetails:error.details});
    }).finally(()=>this.refreshSchedule());
  }
  private runImport(job: Job) {
    void this.background.run('background-import',{operation:job.operation,payload:job.payload,jobId:job.id}).then(result=>{
      if(this.site.store.raw.open)this.site.updateJob(job.id,{status:'complete',message:'导入处理已完成。',result});
    },(error:any)=>{
      if(this.site.store.raw.open&&this.site.job(job.id).status!=='complete')this.site.updateJob(job.id,{status:this.site.job(job.id).cancelRequestedAt?'cancelled':'failed',message:error.message,errorStatus:error.status??400,errorDetails:error.details});
    }).finally(()=>this.refreshSchedule());
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
  /** Return an already-finished interactive command in its submission response. */
  async observe(id:string,maximumMs=300){
    const until=Date.now()+maximumMs;
    for(;;){const job=this.site.job(id);if(!['queued','running'].includes(job.status)||Date.now()>=until)return job;await new Promise(resolve=>setTimeout(resolve,10));}
  }
  query(operation:string,payload:any){
    const feature=operationFeature(operation);
    if(feature&&!siteFeatures(this.site.root).includes(feature))return Promise.reject(new WeavaError('网站未启用此任务所需功能。',404));
    return (['publication-review','publication-plan-review'].includes(operation)?this.publication:this.service).run(operation,payload);
  }
  cancel(id:string){
    const job=this.site.jobStore.cancelJob(id);
    if(job.cancelRequestedAt){this.service.cancelJob(id);this.background.cancelJob(id);this.publication.cancelJob(id);}
    if(job.operation==='media-optimize'&&job.status==='cancelled')updateMediaOptimization(this.site,job.payload.id,{optimization:{status:'failed',error:'图片优化已取消，原图仍可使用。'}});
    return job;
  }
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
  stop() {this.stopped=true;clearInterval(this.timer);clearTimeout(this.dueTimer);this.service.stop();this.background.stop();this.publication.stop();}
}
