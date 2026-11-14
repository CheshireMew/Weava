import { afterEach, expect, it, vi } from 'vitest';
import { api, waitJob } from '../apps/admin/src/api.ts';
import {
  trackTask,
  awaitTask,
  taskSnapshot,
  refreshBackgroundTasks,
  endTaskSession,
} from '../apps/admin/src/task-tracker.ts';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
const job = (id: string, status: string) => ({
  id,
  operation: 'publish',
  status,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  message: status === 'failed' ? '发布失败' : '正在启动任务',
});
afterEach(() => {
  endTaskSession();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  adminQueries.invalidate(true);
});

it('shares one poll between imperative waiters and background views and invalidates once at completion', async () => {
  const fetch = vi.fn(async () => Response.json(job('shared', 'running')));
  vi.stubGlobal('fetch', fetch);
  adminQueries.resume();
  await api('job/shared');
  fetch.mockClear();
  await adminQueries.read('entries/query?page=1', async () => ['before']);
  const original = adminQueries.snapshot('entries/query?page=1').invalidation;
  vi.useFakeTimers();
  trackTask(job('shared', 'queued'), { scope: 'publication', label: '发布' });
  const progress = vi.fn(),
    first = waitJob(job('shared', 'queued'), progress),
    second = awaitTask('shared');
  await vi.dynamicImportSettled();
  await refreshBackgroundTasks();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(adminQueries.snapshot('entries/query?page=1').invalidation).toBe(original);
  fetch.mockResolvedValue(Response.json(job('shared', 'complete')));
  await refreshBackgroundTasks();
  expect((await first).status).toBe('complete');
  expect((await second).status).toBe('complete');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(progress.mock.calls.at(-1)?.[0].status).toBe('complete');
  const completed = adminQueries.snapshot('entries/query?page=1').invalidation;
  expect(completed).toBeGreaterThan(original);
  await refreshBackgroundTasks();
  expect(adminQueries.snapshot('entries/query?page=1').invalidation).toBe(completed);
});

it('keeps both waiting styles attached through a failed progress read and resumes without resubmitting', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(Response.json(job('reconnect', 'complete')));
  vi.stubGlobal('fetch', fetch);
  vi.useFakeTimers();
  adminQueries.resume();
  const progress = vi.fn(),
    waiting = waitJob(job('reconnect', 'running'), progress);
  let completed = false;
  void waiting.then(() => {
    completed = true;
  });
  await vi.dynamicImportSettled();
  await refreshBackgroundTasks();
  expect(completed).toBe(false);
  expect(taskSnapshot().find((task) => task.id === 'reconnect')?.readError).toContain('连接恢复');
  await refreshBackgroundTasks();
  expect((await waiting).status).toBe('complete');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('preserves structured failure details and ignores a late queued response after completion', async () => {
  await expect(
    waitJob(
      { ...job('failed', 'failed'), errorStatus: 409, errorDetails: { revision: 7 } },
      vi.fn(),
    ),
  ).rejects.toMatchObject({
    message: '发布失败',
    status: 409,
    details: { jobId: 'failed', cause: { revision: 7 } },
  });
  trackTask(job('late', 'complete'), { scope: 'publication', label: '发布' });
  trackTask(job('late', 'queued'), { scope: 'operation', label: '等待' });
  expect((await awaitTask('late')).status).toBe('complete');
});
