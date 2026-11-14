import { isMainThread } from 'node:worker_threads';
import { superviseJob } from './job-supervisor.ts';
import { TaskRuntime } from './task-runtime.ts';
const [root, id] = process.argv.slice(2);
if (!root || !id) throw new Error('任务执行缺少网站目录或任务编号。');
if (id === '--service') {
  (await import('./task-service-worker.ts')).serveTasks(root);
} else if (isMainThread) {
  await superviseJob(root, id);
} else {
  const runtime = new TaskRuntime(root);
  try {
    const site = await runtime.database(),
      job = site.job(id);
    if (['queued', 'running'].includes(job.status)) await runtime.executeJob(id);
  } catch (error: any) {
    console.error(String(error.stack ?? error.message).slice(-8192));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}
