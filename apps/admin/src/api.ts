import { createAdminClient, ApiClientError } from '@weava/contracts/api-client';
export { ApiClientError as ApiError } from '@weava/contracts/api-client';
export const api = createAdminClient({ onUnauthorized: () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('weava-session-expired'));
} });
export async function waitJob(job: any, onProgress: (job: any) => void) {
  while (['queued', 'running'].includes(job.status)) {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = await api(`job/${job.id}`);
  }
  onProgress(job);
  if (job.status !== 'complete') throw new Error(job.message);
  return job;
}
