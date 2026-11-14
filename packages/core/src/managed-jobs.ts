import { appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WeavaError, type Job } from '@weava/contracts';
import type { Site } from './site.ts';
import type { JobContext } from './job-context.ts';
import { jobHandler } from './job-operations.ts';

/** Business execution is identical in reusable processes and supervised one-shot workers. */
export async function executeManagedJob(
  site: Site,
  job: Job,
  content: JobContext['content'],
  services: Pick<JobContext, 'stats' | 'imports'> = {},
) {
  if (job.status === 'complete') return job.result;
  if (!['queued', 'running'].includes(job.status))
    throw new WeavaError('任务已结束，不能再次执行。', 409);
  const previousId = process.env.WEAVA_JOB_ID,
    previousRoot = process.env.WEAVA_JOB_ROOT;
  process.env.WEAVA_JOB_ID = job.id;
  process.env.WEAVA_JOB_ROOT = site.root;
  const log = (value: unknown) => {
    const file = join(site.root, 'logs', job.id + '.log');
    try {
      if (!existsSync(file) || statSync(file).size < 8 * 1024 * 1024)
        appendFileSync(file, JSON.stringify(value) + '\n');
    } catch (error) {
      console.error('任务日志写入失败', error);
    }
  };
  try {
    site.jobStore.assertTask();
    site.updateJob(job.id, { status: 'running', workerPid: process.pid, message: '正在执行…' });
    log({ time: new Date().toISOString(), operation: job.operation, executionPid: process.pid });
    const result = await jobHandler(job.operation)({ site, job, content, ...services });
    if (site.job(job.id).status !== 'complete') {
      site.jobStore.assertTask();
      site.updateJob(job.id, { status: 'complete', message: '已完成。', result });
    }
    log({ status: 'complete', jobId: job.id, operation: job.operation });
    return result;
  } catch (error: any) {
    const current = site.job(job.id);
    // Never turn a committed publication/import into a failure because its response was lost.
    if (current.status === 'complete') return current.result;
    site.updateJob(job.id, {
      status: current.cancelRequestedAt ? 'cancelled' : 'failed',
      message: error.message,
      errorStatus: error instanceof WeavaError ? error.status : 400,
      errorDetails: error instanceof WeavaError ? error.details : undefined,
    });
    log({
      status: 'failed',
      jobId: job.id,
      message: String(error.stack ?? error.message).slice(-8192),
    });
    throw error;
  } finally {
    if (previousId === undefined) delete process.env.WEAVA_JOB_ID;
    else process.env.WEAVA_JOB_ID = previousId;
    if (previousRoot === undefined) delete process.env.WEAVA_JOB_ROOT;
    else process.env.WEAVA_JOB_ROOT = previousRoot;
  }
}
