import { api, submitJob, ApiError } from './api.ts';
import { adminQueries } from './query-cache.ts';
import { affectedQueries, jobDomains } from './query-effects.ts';

export interface BackgroundTask {
  id: string;
  scope: string;
  label: string;
  context?: any;
  job: any;
  readError?: string;
}
const storageKey = 'weava-background-tasks';
let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();
let initialized = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  polling: Promise<void> | undefined;
export const taskPending = (task: BackgroundTask | undefined) =>
  !!task && ['queued', 'running', 'unknown'].includes(task.job.status);
function persist() {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(
        tasks.map(({ id, scope, label, context, job }) => ({
          id,
          scope,
          label,
          context,
          operation: job.operation,
        })),
      ),
    );
  } catch {
    /* Quota failures do not interrupt a server job. */
  }
}
function emit() {
  tasks = [...tasks];
  persist();
  for (const listener of [...listeners]) listener();
}
function schedule(delay = 50) {
  if (!timer && tasks.some((task) => taskPending(task) || task.job.status === 'unknown'))
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, delay);
}
function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(saved))
      tasks = saved
        .filter((row) => typeof row.id === 'string' && typeof row.scope === 'string')
        .slice(-20)
        .map((row) => ({
          ...row,
          job: { id: row.id, status: 'unknown', operation: row.operation },
        }));
  } catch {}
  schedule(0);
}
function poll(): Promise<void> {
  if (polling) return polling;
  if (timer) clearTimeout(timer);
  timer = undefined;
  polling = (async () => {
    try {
      await Promise.all(
        tasks
          .filter((task) => taskPending(task) || task.job.status === 'unknown')
          .map(async (task) => {
            try {
              const job: any = await api(`job/${task.id}`);
              if (!tasks.includes(task)) return;
              const wasPending = taskPending(task) || task.job.status === 'unknown';
              task.job = job;
              task.readError = undefined;
              if (wasPending && !taskPending(task)) invalidateJob(job);
            } catch (error: any) {
              if (error.status === 404)
                task.job = { ...task.job, status: 'failed', message: '任务记录已不存在。' };
              else task.readError = '暂时无法读取进度，连接恢复后会继续更新。';
            }
          }),
      );
      emit();
    } finally {
      polling = undefined;
      const active = tasks.filter((task) => taskPending(task) && !task.readError),
        young = active.some((task) => Date.now() - Date.parse(task.job.createdAt ?? '') < 500),
        interactive = active.some((task) => task.scope === 'publication');
      schedule(
        typeof document !== 'undefined' && document.hidden
          ? 3000
          : young
            ? 100
            : interactive
              ? 250
              : 1000,
      );
    }
  })();
  return polling;
}
export const subscribeTasks = (listener: () => void) => {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const taskSnapshot = () => tasks;
function invalidateJob(job: any) {
  if (!job.payload?.options?.dryRun)
    adminQueries.invalidate(false, affectedQueries(jobDomains(job.operation ?? '')));
}
export function trackTask(job: any, description: { scope: string; label: string; context?: any }) {
  initialize();
  const existing = tasks.find((task) => task.id === job.id);
  if (existing) {
    // A delayed submit response must not regress a result already observed by a waiter.
    if (taskPending(existing)) {
      existing.job = job;
      if (!taskPending(existing)) invalidateJob(job);
    }
    existing.context = description.context ?? existing.context;
  } else {
    const task = { id: job.id, ...description, job };
    tasks.push(task);
    if (!taskPending(task)) invalidateJob(job);
  }
  const completed = tasks.filter((task) => !taskPending(task) && task.job.status !== 'unknown');
  const remove = new Set(completed.slice(0, Math.max(0, completed.length - 12)));
  tasks = tasks.filter((task) => !remove.has(task));
  emit();
  schedule(50);
  return job;
}
export async function startTask(
  path: string,
  body: unknown,
  description: { scope: string; label: string; context?: any },
  key?: string,
) {
  return trackTask(await submitJob(path, body, key), description);
}
export function awaitTask(id: string, onProgress?: (job: any) => void): Promise<any> {
  initialize();
  return new Promise((resolve, reject) => {
    const check = () => {
      const task = tasks.find((task) => task.id === id);
      if (!task) return;
      try {
        onProgress?.(task.readError ? { ...task.job, message: task.readError } : task.job);
      } catch (error) {
        listeners.delete(check);
        reject(error);
        return;
      }
      if (taskPending(task)) return;
      listeners.delete(check);
      if (task.job.status === 'complete') resolve(task.job);
      else
        reject(
          new ApiError(task.job.message ?? '任务未完成。', task.job.errorStatus ?? 400, {
            jobId: id,
            cause: task.job.errorDetails,
          }),
        );
    };
    listeners.add(check);
    check();
    schedule();
  });
}
export const refreshBackgroundTasks = () => poll();
export function endTaskSession() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const task of tasks)
    if (taskPending(task) || task.job.status === 'unknown')
      task.job = {
        ...task.job,
        status: 'cancelled',
        message: '已退出登录，服务器上的任务可能仍在处理。',
      };
  emit();
  tasks = [];
  emit();
}
if (typeof window !== 'undefined') window.addEventListener('weava-session-ended', endTaskSession);

/** Both blocking callers and mounted views observe the same durable task. */
export function waitTrackedJob(job: any, onProgress: (job: any) => void): Promise<any> {
  if (!['queued', 'running', 'unknown'].includes(job.status)) {
    invalidateJob(job);
    onProgress(job);
    return job.status === 'complete'
      ? Promise.resolve(job)
      : Promise.reject(
          new ApiError(job.message ?? '任务未完成。', job.errorStatus ?? 400, {
            jobId: job.id,
            cause: job.errorDetails,
          }),
        );
  }
  trackTask(job, { scope: 'operation', label: job.operation ?? '后台任务' });
  return awaitTask(job.id, onProgress);
}
