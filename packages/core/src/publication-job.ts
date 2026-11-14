import type { JobContext } from './job-context.ts';
import { readPublicationCandidate, commitPublication } from './publication.ts';
import { runPublicationPlan } from './publication-plans.ts';
import { runScheduledPublication } from './schedules.ts';
import { executeContentMutation } from './content-mutations.ts';

export async function executePublicationJob({ site, job, content }: JobContext) {
  const { operation, payload: options, id: jobId } = job;
  if (operation !== 'publish') {
    const needsRenderer =
      ['withdraw', 'entry-delete'].includes(operation) &&
      site.release()?.entries.some((entry) => entry.id === options.id);
    return executeContentMutation(
      site,
      needsRenderer ? (await content()).manager : undefined,
      operation,
      options,
      jobId,
    );
  }
  const { manager } = await content(),
    started = performance.now(),
    timings: Record<string, number> = {};
  site.updateJob(jobId, { message: '正在提交发布版本' });
  let result: any;
  if (options.planId)
    result = await runPublicationPlan(
      site,
      options.planId,
      options.planRevision,
      (release) => manager.validateRelease(release),
      options.options,
      jobId,
    );
  else if (options.scheduleId) {
    const release = await runScheduledPublication(
      site,
      options.scheduleId,
      options.scheduleRevision,
      (release) => manager.validateRelease(release),
      Date.now(),
      jobId,
    );
    result = release
      ? { releaseId: release.id, entries: release.entries.length }
      : { skipped: true };
  } else {
    let at = performance.now();
    const prepared = readPublicationCandidate(site, options);
    timings.candidateMs = performance.now() - at;
    at = performance.now();
    await manager.validateRelease(prepared.release);
    timings.extensionsMs = performance.now() - at;
    at = performance.now();
    const release = commitPublication(site, prepared, { ...options, jobId });
    timings.commitMs = performance.now() - at;
    result = { releaseId: release.id, entries: release.entries.length };
  }
  timings.totalMs = performance.now() - started;
  // The publication transaction has already recorded success. Enrich its result without changing that boundary.
  result = { ...result, executionPid: process.pid, timings };
  site.updateJob(jobId, { status: 'complete', message: '发布已完成。', result });
  return result;
}
