import { WeavaError } from '@weava/contracts';
import type { TaskRuntime } from './task-runtime.ts';
export async function executeTaskQuery(runtime: TaskRuntime, operation: string, payload: any) {
  if (
    [
      'managed-job',
      'publication-publish',
      'background-import',
      'content-command',
      'media-optimize',
    ].includes(operation)
  )
    return runtime.executeJob(payload.jobId);
  if (operation.startsWith('analytics-'))
    return (await import('./analytics-task.ts')).queryAnalyticsTask(
      await runtime.stats(),
      operation,
      payload,
    );
  const site = await runtime.database();
  if (operation === 'database-warm') return { ready: true };
  if (operation === 'command-warm') {
    await import('./content-mutations.ts');
    await import('./media.ts');
    return { ready: true };
  }
  if (operation === 'background-warm') {
    await import('./maintenance.ts');
    await import('./backup.ts');
    return { ready: true };
  }
  if (operation === 'seo-audits') return (await import('./seo-audit.ts')).seoAudits(site);
  if (operation === 'legacy-media-stage')
    return (await import('./legacy-media-upload.ts')).decodeLegacyMediaUpload(site, payload.path);
  if (operation === 'media-references')
    return (await import('./media.ts')).mediaReferences(site, payload.id);
  if (operation === 'media-delete-preview')
    return (await import('./media-deletion.ts')).previewMediaDeletion(site, payload.id);
  if (operation === 'storage-usage') return (await import('./maintenance.ts')).storageUsage(site);
  if (operation === 'archive-plan') {
    const plan = (await import('./history-archive.ts')).planHistoryArchive(site, payload);
    return {
      options: plan.options,
      releases: plan.releaseIds.length,
      revisions: plan.revisions.length,
      protectedReleases: plan.protectedReleases,
      protectedRevisions: plan.protectedRevisions,
      review: plan.review,
    };
  }
  if (operation === 'archive-contents')
    return (await import('./history-archive.ts')).historyArchiveContents(site, payload.id, payload);
  const { manager } = await runtime.content();
  const { preparePublication, savePublicationReview, primePublication } = await import(
    './publication.ts'
  );
  if (operation === 'publication-warm') {
    primePublication(site);
    return { ready: true, executionPid: process.pid };
  }
  if (operation === 'publication-review') {
    const start = performance.now(),
      prepared = preparePublication(site, payload),
      afterPrepare = performance.now();
    await manager.validateRelease(prepared.release);
    const afterExtensions = performance.now(),
      review = savePublicationReview(site, payload, prepared);
    return {
      ...review,
      timings: {
        prepareMs: afterPrepare - start,
        extensionsMs: afterExtensions - afterPrepare,
        candidateMs: performance.now() - afterExtensions,
        totalMs: performance.now() - start,
      },
    };
  }
  if (operation === 'publication-plan-review') {
    const { planOptions } = await import('./publication-plans.ts');
    const row = site.store.get('publication-plan', payload.id);
    if (
      !row ||
      row.revision !== payload.revision ||
      !['draft', 'scheduled', 'failed'].includes(row.value.status)
    )
      throw new WeavaError('计划已变化，请重新载入。', 409);
    const options = planOptions(site, row.value),
      prepared = preparePublication(site, options);
    await manager.validateRelease(prepared.release);
    return { plan: row, review: savePublicationReview(site, options, prepared) };
  }
  throw new WeavaError('未知计算操作：' + operation);
}
