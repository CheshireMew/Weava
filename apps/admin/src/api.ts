export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: any) { super(message); }
}
export async function api(path: string, value?: any) {
  const response = await fetch('/api/admin/v1/' + path, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error, response.status, result.details);
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
