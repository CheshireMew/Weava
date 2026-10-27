import { Site } from './site.ts';
import { createBackup, verifyBackup } from './backup.ts';
import { uploadMedia } from './media.ts';
import { inside } from './storage.ts';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const [root, id] = process.argv.slice(2);
const site = new Site(root);
const job = site.job(id);
if (!['queued', 'running'].includes(job.status)) {
  site.close();
  process.exit(0);
}
try {
  site.updateJob(id, { status: 'running', workerPid: process.pid, message: '正在执行…' });
  console.log(new Date().toISOString(), job.operation);
  let result: any;
  if (job.operation === 'publish') {
    const release = site.publish({ ...job.payload, jobId: id });
    result = { releaseId: release.id, entries: release.entries.length };
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
  else throw new Error('未知任务：' + job.operation);
  site.updateJob(id, { status: 'complete', message: '已完成。', result });
  console.log(JSON.stringify(result));
} catch (error: any) {
  site.updateJob(id, { status: 'failed', message: error.message });
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  site.close();
}
