import {processAlive} from './instance-access.ts';

import {Storage} from './storage.ts';
import {now,uuid,digest} from '../../runtime-common/src/identity.ts';

import {WeavaError,type Job} from '@weava/contracts';
import {appendSiteEvent} from './site-events.ts';
export class JobStore {
  constructor(private store: Storage) {}
  job(id: string): Job {
    const row = this.store.raw.prepare('SELECT data FROM jobs WHERE id=?').get(id) as any;
    if (!row) throw new WeavaError('任务不存在。', 404);
    return JSON.parse(row.data);
  }
  jobs(summary = false): Job[] {
    return (
      this.store.raw
        .prepare(
          'SELECT ' +
            (summary ? "json_remove(data,'$.result','$.payload')" : 'data') +
            ' data FROM jobs ORDER BY rowid DESC LIMIT 100',
        )
        .all() as any[]
    ).map((r) => JSON.parse(r.data));
  }
  createJob(operation: string, payload: any = {}, key?: string) {
    if (key) {
      const existing = this.store.raw
        .prepare('SELECT data FROM jobs WHERE idempotency=?')
        .get(key) as any;
      if (existing) {
        const job = JSON.parse(existing.data) as Job;
        if (job.operation !== operation || digest(job.payload) !== digest(payload))
          throw new WeavaError('相同请求标识不能用于不同的操作。', 409);
        return job;
      }
    }
    const job: Job = {
      id: uuid(),
      operation,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      message: '等待执行',
      payload,
    };
    try {
      this.store.raw
        .prepare('INSERT INTO jobs VALUES(?,?,?,?,?)')
        .run(job.id, operation, job.status, JSON.stringify(job), key ?? null);
    } catch {
      throw new WeavaError('同类任务正在运行，请等待完成。', 409);
    }
    return job;
  }
  updateJob(id: string, updates: Partial<Job>) {
    return this.store.raw.transaction(()=>{
    const previous=this.job(id),job = { ...previous, ...updates, updatedAt: now() };
    this.store.raw
      .prepare('UPDATE jobs SET status=?,data=? WHERE id=?')
      .run(job.status, JSON.stringify(job), id);
    if(previous.status!==job.status&&['complete','failed','cancelled','recovery_required'].includes(job.status)&&['publish','backup'].includes(job.operation)) {
      const type=job.operation==='backup'?'backup':job.payload?.scheduleId?'publication.scheduled':'publication';
      appendSiteEvent(this.store.raw,type+'.'+job.status,{jobId:id,operation:job.operation,status:job.status,message:job.message,...(job.result?.releaseId?{releaseId:job.result.releaseId}:{}),...(job.payload?.scheduleId?{scheduleId:job.payload.scheduleId}:{})},'job:'+id+':'+job.status);
    }
    return job;
    }).immediate();
  }
  recoverJobs() {
    for (const job of this.activeJobs()) {
      if (job.status === 'queued' && job.managed) continue;
      if (job.workerPid && processAlive(job.workerPid)) continue;
      if (job.operation === 'media-optimize' && !job.cancelRequestedAt) {
        this.updateJob(job.id, { status: 'queued', workerPid: undefined, message: '等待继续优化图片，原图可使用。' });
        continue;
      }
      if (
        job.operation === 'publish' &&
        job.result?.releaseId &&
        job.result.releaseId === this.store.state('release')
      )
        this.updateJob(job.id, { status: 'complete', message: '发布已完成。' });
      else
        this.updateJob(job.id, {
          status: 'failed',
          message: '上次任务中断，当前公开版本保持有效；可重试。',
        });
    }
  }
  cancelJob(id:string){
    return this.store.raw.transaction(()=>{
      const job=this.job(id);if(!['queued','running'].includes(job.status))return job;
      return this.updateJob(id,{cancelRequestedAt:Date.now(),...(job.status==='queued'?{status:'cancelled' as const,message:'已取消。'}:{message:'正在取消，等待任务停止。'})});
    }).immediate();
  }
  activeJobs(): Job[] {
    return (
      this.store.raw
        .prepare("SELECT data FROM jobs WHERE status IN ('queued','running') ORDER BY rowid")
        .all() as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
}
