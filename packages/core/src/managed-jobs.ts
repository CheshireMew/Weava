import {appendFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {WeavaError,type Job} from '@weava/contracts';
import type {Site} from './site.ts';
import type {ExtensionManager} from './extension-manager.ts';
import {inside} from '../../runtime-common/src/paths.ts';

/** Runs in a reusable child. The parent owns its deadline and can terminate a blocked job. */
export async function executeManagedJob(site:Site,job:Job,content:()=>Promise<{manager:ExtensionManager}>) {
  const previousId=process.env.WEAVA_JOB_ID,previousRoot=process.env.WEAVA_JOB_ROOT;
  process.env.WEAVA_JOB_ID=job.id;process.env.WEAVA_JOB_ROOT=site.root;
  const log=(value:unknown)=>{
    const file=join(site.root,'logs',job.id+'.log');
    try{if(!existsSync(file)||statSync(file).size<8*1024*1024)appendFileSync(file,typeof value==='string'?value+'\n':JSON.stringify(value)+'\n');}
    catch(error){console.error('任务日志写入失败',error);}
  };
  try {
    site.store.assertTask();
    site.updateJob(job.id,{workerPid:process.pid,message:'正在执行…'});
    log(new Date().toISOString()+' '+job.operation);
    let result:unknown;
    if(job.operation==='withdraw'||job.operation==='entry-delete'){
      // Unpublished drafts need neither a renderer nor a publication candidate.
      const published=site.release()?.entries.some(entry=>entry.id===job.payload.id);
      const manager=published?(await content()).manager:undefined;
      result=await(await import('./content-mutations.ts')).executeContentMutation(site,manager,job.operation,job.payload,job.id);
    } else if(job.operation==='storage-scan'){
      const usage=(await import('./maintenance.ts')).storageUsage(site),checkedAt=new Date().toISOString();
      site.store.setState('storage-usage',JSON.stringify({checkedAt,usage}));result={checkedAt};
    } else if(job.operation==='backup'){
      result=await(await import('./backup.ts')).createBackup(site,job.payload.path??process.env.WEAVA_BACKUP_ROOT??'D:/Tools/weava/backups',job.payload.label);
    } else if(job.operation==='verify'){
      const {recordBackupVerification}=await import('./backup-management.ts');
      try{result=(await import('./backup.ts')).verifyBackup(job.payload.path);recordBackupVerification(site,job.payload.path);}
      catch(error:any){recordBackupVerification(site,job.payload.path,error.message);throw error;}
    } else if(job.operation.startsWith('markdown-')){
      await content();const markdown=await import('./markdown-folder.ts');
      if(job.operation==='markdown-export')result=markdown.exportMarkdownFolder(site,job.payload.path,job.payload.budgetBytes);
      else if(job.operation==='markdown-preview')result=markdown.previewMarkdownFolder(site,job.payload.path,job.payload.options);
      else if(job.operation==='markdown-import')result=await markdown.importMarkdownFolder(site,job.payload.path,job.payload.options);
      else throw new WeavaError('未知 Markdown 操作。');
    } else if(job.operation==='analytics-archive'||job.operation==='analytics-restore'){
      const {Analytics}=await import('./analytics.ts'),analytics=new Analytics(site.root);
      try{result=job.operation==='analytics-archive'?analytics.archive(job.payload.before,job.payload.review,job.payload.budgetBytes):analytics.restoreArchive(job.payload.id);}finally{analytics.close();}
    } else if(job.operation==='import-json'){
      result=(await import('./json-import.ts')).executeJsonImport(site,job.id,job.payload);
    } else if(job.operation==='archive-history'){
      result=await(await import('./history-archive.ts')).archiveHistory(site,job.payload.options,job.payload.review);
    } else if(job.operation==='restore-history'){
      result=(await import('./history-archive.ts')).restoreHistoryArchive(site,job.payload.id);
    } else if(job.operation==='media'){
      result=job.payload.uploadId
        ?await(await import('./media-upload.ts')).completeMediaUpload(site,job.payload.uploadId,job.id)
        :await(await import('./media.ts')).uploadMedia(site,inside(join(site.root,'media'),job.payload.path),job.payload.name);
    } else if(job.operation==='seo-audit'){
      const {manager}=await content();
      result=await(await import('./seo-task.ts')).executeSeoAudit(site,manager,job.payload,message=>site.updateJob(job.id,{message}));
    } else throw new WeavaError('未知复用任务：'+job.operation);
    if(site.job(job.id).status!=='complete'){
      site.store.assertTask();site.updateJob(job.id,{status:'complete',message:'已完成。',result});
    }
    log({status:'complete',jobId:job.id,operation:job.operation});
    return result;
  } catch(error:any) {
    log({status:'failed',jobId:job.id,message:String(error.stack??error.message).slice(-8192)});
    throw error;
  } finally {
    if(previousId===undefined)delete process.env.WEAVA_JOB_ID;else process.env.WEAVA_JOB_ID=previousId;
    if(previousRoot===undefined)delete process.env.WEAVA_JOB_ROOT;else process.env.WEAVA_JOB_ROOT=previousRoot;
  }
}
