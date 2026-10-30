import { Site } from './site.ts';
import { createBackup, verifyBackup } from './backup.ts';
import { uploadMedia, cropMedia } from './media.ts';
import { inside } from './storage.ts';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { extension } from './extensions.ts';
import { Analytics } from './analytics.ts';
import { importWordPressWxr } from './wordpress-wxr.ts';
import { archiveHistory, restoreHistoryArchive } from './history-archive.ts';
import { preparePublication } from './publication.ts';
import { runPublicationPlan } from './publication-plans.ts';
import { imageVariant } from './image-variants.ts';
const [root, id] = process.argv.slice(2);
const site = new Site(root);
const job = site.job(id);
let extensionAnalytics: Analytics | undefined;
if (!['queued', 'running'].includes(job.status)) {
  site.close();
  process.exit(0);
}
try {
  site.updateJob(id, { status: 'running', workerPid: process.pid, message: '正在执行…' });
  console.log(new Date().toISOString(), job.operation);
  let result: any;
  if (job.operation === 'publish') {
    // Use the same registered block renderers as the web process before committing a candidate.
    extensionAnalytics = new Analytics(root);
    const manager=await extension(site, { analytics: extensionAnalytics }, { mode: 'worker' });
    if (job.payload.planId) result = await runPublicationPlan(site, job.payload.planId, job.payload.planRevision, (release) => manager.validateRelease(release), job.payload.options, id);
    else {
    const review=site.previewPublication(job.payload);
    await manager.validateRelease(preparePublication(site,review.options).release);
    const release = site.publish({ ...review.options, jobId: id });
    result = { releaseId: release.id, entries: release.entries.length };
    }
  } else if (job.operation === 'backup')
    result = await createBackup(
      site,
      job.payload.path ?? 'D:/Tools/weava/backups',
      job.payload.label,
    );
  else if (job.operation === 'verify') result = verifyBackup(job.payload.path);
  else if (job.operation === 'media')
    result = await uploadMedia(
      site,
      readFileSync(inside(join(site.root, 'media'), job.payload.path)),
      job.payload.name,
    );
  else if (job.operation === 'media-edit') result = await cropMedia(site, job.payload.id, job.payload.revision, job.payload.crop);
  else if (job.operation === 'media-variant') result = await imageVariant(site, job.payload);
  else if (job.operation === 'import-wxr') result = await importWordPressWxr(site, readFileSync(inside(join(site.root, 'imports'), job.payload.sourcePath), 'utf8'), job.payload.options, (message) => site.updateJob(id, { message }));
  else if (job.operation === 'archive-history') result = await archiveHistory(site, job.payload.options, job.payload.review);
  else if (job.operation === 'restore-history') result = restoreHistoryArchive(site, job.payload.id);
  else throw new Error('未知任务：' + job.operation);
  site.updateJob(id, { status: 'complete', message: '已完成。', result });
  console.log(JSON.stringify(result));
} catch (error: any) {
  site.updateJob(id, { status: 'failed', message: error.message });
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  extensionAnalytics?.close();
  site.close();
}
