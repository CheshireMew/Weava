import { processAlive } from './instance-access.ts';

import { Storage } from './storage.ts';
import { now, uuid, digest } from '../../runtime-common/src/identity.ts';

import { WeavaError, type Job } from '@weava/contracts';
import { appendSiteEvent } from './site-events.ts';
export class JobStore {
  constructor(private store: Storage) {}
  get open() {
    return this.store.raw.open;
  }
  get inTransaction() {
    return this.store.raw.inTransaction;
  }
  assertTask() {
    this.store.assertTask();
  }
  idempotent(key: string) {
    return this.store.raw.prepare('SELECT id,status FROM jobs WHERE idempotency=?').get(key) as
      | { id: string; status: Job['status'] }
      | undefined;
  }
  enqueueManaged(operation: string, payload: any, maximum: number, key?: string) {
    return this.store.raw
      .transaction(() => {
        if (key && this.idempotent(key)) return this.createJob(operation, payload, key);
        const count = this.store.raw
          .prepare("SELECT COUNT(*) n FROM jobs WHERE status='queued'")
          .get() as { n: number };
        if (count.n >= maximum) throw new WeavaError('待执行任务已满，请等待已有任务完成。', 429);
        const job = this.createJob(operation, payload, key);
        return this.updateJob(job.id, { managed: true });
      })
      .immediate();
  }
  enqueueCommand(operation: string, payload: any, maximum: number) {
    return this.store.raw
      .transaction(() => {
        let key = 'command:' + digest({ operation, payload });
        for (;;) {
          const previous = this.idempotent(key);
          if (!previous || !['failed', 'cancelled'].includes(previous.status))
            return this.enqueueManaged(operation, payload, maximum, key);
          key = 'command-retry:' + previous.id;
        }
      })
      .immediate();
  }
  hasManagedQueue() {
    return !!this.store.raw
      .prepare(
        "SELECT 1 FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 LIMIT 1",
      )
      .get();
  }
  claimNext(
    select: (
      queued: Pick<Job, 'id' | 'operation'>[],
      running: Job[],
    ) => Pick<Job, 'id' | 'operation'> | undefined,
    timeoutMs: number,
  ) {
    return this.store.raw
      .transaction(() => {
        const queued = this.store.raw
          .prepare(
            "SELECT id,operation FROM jobs WHERE status='queued' AND json_extract(data,'$.managed')=1 ORDER BY CASE WHEN operation='media-optimize' THEN 2 WHEN operation IN ('schedule-create','plan-save') THEN 0 ELSE 1 END,rowid LIMIT 128",
          )
          .all() as Pick<Job, 'id' | 'operation'>[];
        const next = select(
          queued,
          this.activeJobs().filter((job) => job.status === 'running'),
        );
        return next
          ? this.updateJob(next.id, {
              status: 'running',
              workerPid: process.pid,
              deadlineAt: Date.now() + timeoutMs,
              heartbeatAt: Date.now(),
              message: next.operation === 'publish' ? '正在提交发布版本' : '正在启动任务',
            })
          : null;
      })
      .immediate();
  }
  /** The mutation and durable result share the same database commit. */
  commitResult(id: string, action: () => unknown) {
    return this.store.raw
      .transaction(() => {
        this.store.assertTask();
        const result = action();
        this.updateJob(id, { status: 'complete', message: '已完成。', result });
        return result;
      })
      .immediate();
  }
  job(id: string): Job {
    const row = this.store.raw.prepare('SELECT data FROM jobs WHERE id=?').get(id) as any;
    if (!row) throw new WeavaError('任务不存在。', 404);
    return JSON.parse(row.data);
  }
  latestMediaOptimization(id: string): Job | null {
    const row = this.store.raw
      .prepare(
        "SELECT data FROM jobs WHERE operation='media-optimize' AND json_extract(data,'$.payload.id')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
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
    return this.store.raw
      .transaction(() => {
        const previous = this.job(id),
          job = { ...previous, ...updates, updatedAt: now() };
        this.store.raw
          .prepare('UPDATE jobs SET status=?,data=? WHERE id=?')
          .run(job.status, JSON.stringify(job), id);
        if (
          previous.status !== job.status &&
          ['complete', 'failed', 'cancelled', 'recovery_required'].includes(job.status) &&
          ['publish', 'backup'].includes(job.operation)
        ) {
          const type =
            job.operation === 'backup'
              ? 'backup'
              : job.payload?.scheduleId
                ? 'publication.scheduled'
                : 'publication';
          appendSiteEvent(
            this.store.raw,
            type + '.' + job.status,
            {
              jobId: id,
              operation: job.operation,
              status: job.status,
              message: job.message,
              ...(job.result?.releaseId ? { releaseId: job.result.releaseId } : {}),
              ...(job.payload?.scheduleId ? { scheduleId: job.payload.scheduleId } : {}),
            },
            'job:' + id + ':' + job.status,
          );
        }
        return job;
      })
      .immediate();
  }
  recoverJobs(options: { restored?: boolean } = {}) {
    for (const job of this.activeJobs()) {
      // A restored database belongs to a new execution context, even when the
      // source process still exists. Never replay copied commands automatically.
      if (!options.restored) {
        if (job.status === 'queued' && job.managed) continue;
        if (job.workerPid && processAlive(job.workerPid)) continue;
      }
      const detached = { workerPid: undefined, heartbeatAt: undefined, deadlineAt: undefined };
      if (job.operation === 'media-optimize' && !job.cancelRequestedAt) {
        this.updateJob(job.id, {
          ...detached,
          status: 'queued',
          message: '等待继续优化图片，原图可使用。',
        });
        continue;
      }
      if (
        job.operation === 'publish' &&
        job.result?.releaseId &&
        job.result.releaseId === this.store.state('release')
      )
        this.updateJob(job.id, { ...detached, status: 'complete', message: '发布已完成。' });
      else
        this.updateJob(job.id, {
          ...detached,
          status: options.restored && job.cancelRequestedAt ? 'cancelled' : 'failed',
          message: options.restored
            ? '网站已从备份恢复，原站点任务不会在此副本继续执行；请检查结果后重新发起。'
            : '上次任务中断，当前公开版本保持有效；可重试。',
        });
    }
  }
  cancelJob(id: string) {
    return this.store.raw
      .transaction(() => {
        const job = this.job(id);
        if (!['queued', 'running'].includes(job.status)) return job;
        return this.updateJob(id, {
          cancelRequestedAt: Date.now(),
          ...(job.status === 'queued'
            ? { status: 'cancelled' as const, message: '已取消。' }
            : { message: '正在取消，等待任务停止。' }),
        });
      })
      .immediate();
  }
  activeJobs(): Job[] {
    return (
      this.store.raw
        .prepare("SELECT data FROM jobs WHERE status IN ('queued','running') ORDER BY rowid")
        .all() as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
}
