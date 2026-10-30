export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: any) { super(message); }
}
export async function api(path: string, value?: any) {
  let response: Response;
  try {
    response = await fetch('/api/admin/v1/' + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error: any) {
    throw new ApiError(error.name === 'TimeoutError'
      ? '网站响应超时，请稍后重试。'
      : '无法连接网站，请检查服务和网络后重试。', 0);
  }
  let result: any;
  try { result = await response.json(); }
  catch { throw new ApiError('网站没有返回有效结果，请稍后重试。', response.status); }
  if (!response.ok) {
    if (response.status === 401 && !['login', 'session'].includes(path) && typeof window !== 'undefined') window.dispatchEvent(new Event('weava-session-expired'));
    throw new ApiError(result.error || '操作没有完成，请重试。', response.status, result.details);
  }
  return result;
}
export async function waitJob(job: any, onProgress: (job: any) => void) {
  while (['queued', 'running'].includes(job.status)) {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = await api('job/' + job.id);
  }
  onProgress(job);
  if (job.status !== 'complete') throw new Error(job.message);
  return job;
}
