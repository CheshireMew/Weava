import {Site} from './site.ts';
import {createBackup,verifyBackup} from './backup.ts';
import {uploadMedia,cropMedia} from './media.ts';
import {inside} from '../../runtime-common/src/paths.ts';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {completeMediaUpload} from './media-upload.ts';
import {extension} from './extensions.ts';
import {Analytics} from './analytics.ts';
import {importWordPressWxr} from './wordpress-wxr.ts';
import {archiveHistory,restoreHistoryArchive} from './history-archive.ts';
import {readPublicationCandidate,commitPublication} from './publication.ts';
import {runPublicationPlan} from './publication-plans.ts';
import {runScheduledPublication} from './schedules.ts';
import {imageVariant} from './image-variants.ts';
import {WeavaError} from '@weava/contracts';
import {siteFeatures} from './site-features.ts';
import {BusinessStore,websiteContext,withWebsite} from './site-sdk.ts';
import {migrateWebsite} from './site-migrations.ts';
import {readJobLog} from './job-logs.ts';
const [root, id] = process.argv.slice(2);
if(id==='--service'){
  (await import('./task-service-worker.ts')).serveTasks(root);
}else{
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
    if(siteFeatures(root).includes('analytics'))extensionAnalytics = new Analytics(root);
    const manager=await extension(site, extensionAnalytics?{ analytics: extensionAnalytics }:{}, { mode: 'worker' });
    if (job.payload.planId) result = await runPublicationPlan(site, job.payload.planId, job.payload.planRevision, (release) => manager.validateRelease(release), job.payload.options, id);
    else if(job.payload.scheduleId){
      const release=await runScheduledPublication(site,job.payload.scheduleId,job.payload.scheduleRevision,release=>manager.validateRelease(release),Date.now(),id);
      result=release?{releaseId:release.id,entries:release.entries.length}:{skipped:true};
    }
    else {
    const prepared=readPublicationCandidate(site,job.payload);
    await manager.validateRelease(prepared.release);
    const release = commitPublication(site,prepared,{...job.payload,jobId:id});
    result = { releaseId: release.id, entries: release.entries.length };
    }
  } else if (job.operation.startsWith('analytics-')) {
    extensionAnalytics = new Analytics(root);
    const params = new URLSearchParams(job.payload.query);
    if(job.operation==='analytics-report')result=extensionAnalytics.report(params,job.payload.timezone);
    else if(job.operation==='analytics-export')result=extensionAnalytics.export(params,job.payload.timezone);
    else if(job.operation==='analytics-realtime')result=extensionAnalytics.realtime(params);
    else if(job.operation==='analytics-visitor')result=extensionAnalytics.visitor(job.payload.id,params,job.payload.timezone);
    else throw new Error('未知统计操作');
  } else if (job.operation === 'preflight-wxr') result = await importWordPressWxr(site,{file:inside(join(site.root,'imports'),job.payload.sourcePath)},{...job.payload.options,dryRun:true});
  else if (job.operation === 'backup')
    result = await createBackup(
      site,
      job.payload.path ?? process.env.WEAVA_BACKUP_ROOT ?? 'D:/Tools/weava/backups',
      job.payload.label,
    );
  else if (job.operation === 'verify') result = verifyBackup(job.payload.path);
  else if (job.operation === 'media'){
    result=job.payload.uploadId?await completeMediaUpload(site,job.payload.uploadId,id)
      :await uploadMedia(site,inside(join(site.root,'media'),job.payload.path),job.payload.name);
  }
  else if (job.operation === 'media-edit') result = await cropMedia(site, job.payload.id, job.payload.revision, job.payload.crop);
  else if (job.operation === 'media-variant') result = await imageVariant(site, job.payload);
  else if (job.operation === 'import-wxr') result = await importWordPressWxr(site, {file:inside(join(site.root, 'imports'), job.payload.sourcePath)}, job.payload.options, (message) => site.updateJob(id, { message }));
  else if (job.operation === 'archive-history') result = await archiveHistory(site, job.payload.options, job.payload.review);
  else if (job.operation === 'restore-history') result = restoreHistoryArchive(site, job.payload.id);
  else if(job.operation.startsWith('website:')){
    if(siteFeatures(root).includes('analytics'))extensionAnalytics=new Analytics(root);
    const manager=await extension(site,extensionAnalytics?{analytics:extensionAnalytics}:{},{mode:'worker'});
    const selection=JSON.parse(readFileSync(join(root,'program.json'),'utf8'));
    await migrateWebsite(root,selection.siteBuildId,'open');
    const business=new BusinessStore(root);
    try{
      const context=websiteContext(site,business,{enqueue:(operation,payload,key)=>{const created=site.createJob(operation,payload,key);return site.updateJob(created.id,{managed:true});},get:site.job.bind(site),log:(id,offset)=>readJobLog(join(root,'logs',id+'.log'),offset)},new Request(new URL('/__task/'+id,site.settings().value.domain)));
      result=await withWebsite(context,()=>manager.runJob(job.operation.slice(8),job.payload));
    }finally{business.close();}
  }
  else throw new Error('未知任务：' + job.operation);
  site.updateJob(id, { status: 'complete', message: '已完成。', result });
  console.log(JSON.stringify({status:'complete',jobId:id,operation:job.operation}));
} catch (error: any) {
  site.updateJob(id, { status: 'failed', message: error.message, errorStatus: error instanceof WeavaError ? error.status : 400, errorDetails: error instanceof WeavaError ? error.details : undefined });
  console.error(String(error.stack ?? error.message).slice(-8192));
  process.exitCode = 1;
} finally {
  extensionAnalytics?.close();
  site.close();
}
}
