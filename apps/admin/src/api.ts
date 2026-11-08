import type { AdminClient } from '@weava/contracts/api-client';
import { ApiClientError } from '@weava/contracts/api-error';
import { requestApi } from '@weava/contracts/api-transport';
import {
  accountAccessBody,
  accountAccessResult,
  completeAccountAccessBody,
  completeAccountAccessResult,
  loginBody,
  loginResult,
  logoutResult,
  sessionResult,
} from '@weava/contracts/session-api';
import { adminQueries } from './query-cache.ts';
import { affectedQueries, jobDomains, mutationDomains } from './query-effects.ts';
export { ApiClientError as ApiError } from '@weava/contracts/api-error';
const unauthorized = () => {
  adminQueries.suspend();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('weava-session-expired'));
};
const signedOut = () => {
  adminQueries.suspend();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('weava-session-ended'));
};
let fullClient: Promise<AdminClient> | undefined;
const client = () =>
  (fullClient ??= import('@weava/contracts/api-client').then((module) =>
    module.createAdminClient({ onUnauthorized: unauthorized }),
  ));
async function transport(path: string, body?: unknown): Promise<any> {
  if (!['session', 'login', 'logout', 'account-access', 'account-access/complete'].includes(path))
    return (await client()).request(path, body);
  try {
    if ((path === 'session' && body !== undefined) || (path !== 'session' && body === undefined))
      throw new Error('method');
    if (path === 'login') body = loginBody.parse(body);
    if (path === 'account-access') body = accountAccessBody.parse(body);
    if (path === 'account-access/complete') body = completeAccountAccessBody.parse(body);
    if (path === 'logout' && (!body || typeof body !== 'object' || Object.keys(body).length))
      throw new Error('body');
  } catch (error: any) {
    throw new ApiClientError('请求参数无效。', 400, error.issues);
  }
  const contract =
    path === 'session'
      ? sessionResult
      : path === 'login'
        ? loginResult
        : path === 'account-access'
          ? accountAccessResult
          : path === 'account-access/complete'
            ? completeAccountAccessResult
            : logoutResult;
  return requestApi<unknown>(
    path,
    body,
    contract,
    { onUnauthorized: unauthorized },
    { anonymous: path !== 'logout' },
  );
}
async function perform(path: string, body: unknown, execute: () => Promise<any>): Promise<any> {
  const mutation = body !== undefined;
  const authentication = ['login', 'logout', 'account-access/complete'].includes(path);
  if (path === 'logout') adminQueries.suspend();
  else if (authentication && mutation) adminQueries.invalidate(true);
  const end =
    mutation && !authentication
      ? adminQueries.beginWrite(affectedQueries(mutationDomains(path, body)))
      : () => {};
  try {
    const value = await execute();
    if (path === 'login' || path === 'account-access/complete') adminQueries.resume();
    if (path === 'logout') signedOut();
    return value;
  } catch (error) {
    if (path === 'logout') {
      // The response may have been lost after commit. Resolve the session, not a guess.
      try {
        const session = await transport('session');
        if (session.authenticated) adminQueries.resume();
        else signedOut();
      } catch {
        unauthorized();
      }
    }
    throw error;
  } finally {
    end();
  }
}
async function request(path: string, body?: unknown): Promise<any> {
  return perform(path, body, () => transport(path, body));
}
export const api = Object.assign(request, {
  request,
  call: async (...args: Parameters<AdminClient['call']>) => {
    const { adminApi } = await import('@weava/contracts/api');
    return perform(adminApi[args[0]].path, 'body' in args[1] ? args[1].body : undefined, async () =>
      (await client()).call(...args),
    );
  },
}) as AdminClient;
export async function waitJob(job: any, onProgress: (job: any) => void) {
  let interval = 150;
  while (['queued', 'running'].includes(job.status)) {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, interval));
    try {
      job = await api(`job/${job.id}`);
      interval = Math.min(500, interval * 2);
    } catch (error: any) {
      throw new ApiClientError(
        '暂时无法读取任务进度，任务可能仍在执行，可在任务记录中继续查看。',
        error.status ?? 0,
        { jobId: job.id, cause: error.details },
      );
    }
  }
  onProgress(job);
  adminQueries.invalidate(false, affectedQueries(jobDomains(job.operation ?? '')));
  if (job.status !== 'complete')
    throw new ApiClientError(job.message, job.errorStatus ?? 400, {
      jobId: job.id,
      cause: job.errorDetails,
    });
  return job;
}
