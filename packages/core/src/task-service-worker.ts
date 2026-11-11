import type { Site } from './site.ts';
import type { Analytics } from './analytics.ts';
import type { extension } from './extensions.ts';
import { WeavaError } from '../../contracts/src/errors.ts';
import { statSync,appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {siteFeatures} from './site-features.ts';

export function serveTasks(root:string) {
  let site:Site|undefined, analytics:Analytics|undefined, manager:Awaited<ReturnType<typeof extension>>|undefined;
  let extensionKey='';
  let stopping=false;
  let queue=Promise.resolve();
  let imports:typeof import('./import-sources.ts')|undefined;
  const database=async()=>site??=new (await import('./site.ts')).Site(root);
  const stats=async()=>analytics??=new (await import('./analytics.ts')).Analytics(root);
  const content=async()=>{
    const {Site}=await import('./site.ts'),{walk,digest}=await import('./storage.ts'),{extension}=await import('./extensions.ts');
    site??=new Site(root);
    const statePath=join(root,'extensions','state').replaceAll('\\','/')+'/';
    const key=digest([site.store.raw.prepare("SELECT scope,id,revision FROM records WHERE scope IN ('extension-config','extension-schema','extension-block') ORDER BY scope,id").all(),
      walk(join(root,'extensions')).filter(file=>!file.replaceAll('\\','/').startsWith(statePath)).map(file=>{const info=statSync(file);return[file,info.size,info.mtimeMs];})]);
    if(manager&&key!==extensionKey){await manager.stop();manager=undefined;}
    if(!manager){const analytics=siteFeatures(root).includes('analytics')?await stats():undefined;manager=await extension(site,analytics?{analytics}:{},{mode:'worker'});extensionKey=key;}
    return {site,manager};
  };
  const optimize=async(payload:any)=>{
    site??=new (await import('./site.ts')).Site(root);
    return (await import('./media.ts')).optimizeMedia(site,payload.id,payload.jobId);
  };
  const execute=async(operation:string,payload:any)=>{
    if(operation==='media-optimize')return optimize(payload);
    if(operation.startsWith('analytics-')){
      const analytics=await stats(),params=new URLSearchParams(payload.query);
      if(operation==='analytics-report')return analytics.report(params,payload.timezone);
      if(operation==='analytics-discovery')return analytics.discovery(params,payload.timezone);
      if(operation==='analytics-archive-preview')return analytics.previewArchive(payload.before);
      if(operation==='analytics-realtime')return analytics.realtime(params);
      if(operation==='analytics-visitor')return analytics.visitor(payload.id,params,payload.timezone);
      if(operation==='analytics-export')return analytics.export(params,payload.timezone);
    }
    const site=await database();
    if(operation==='database-warm')return {ready:true};
    if(operation==='command-warm'){await import('./content-mutations.ts');await import('./media.ts');return {ready:true};}
    if(operation==='background-warm'){await import('./maintenance.ts');await import('./backup.ts');return {ready:true};}
    if(operation==='managed-job')return(await import('./managed-jobs.ts')).executeManagedJob(site,site.job(payload.jobId),content);
    if(operation==='background-import'){
      await content();
      imports??=await import('./import-sources.ts');
      const previousId=process.env.WEAVA_JOB_ID,previousRoot=process.env.WEAVA_JOB_ROOT;
      process.env.WEAVA_JOB_ID=payload.jobId;process.env.WEAVA_JOB_ROOT=site.root;
      try {
        site.store.assertTask();
        const options={...payload.payload.options,dryRun:payload.operation==='preflight-wxr'||payload.payload.options?.dryRun===true};
        const progress=(message:string)=>site.updateJob(payload.jobId,{message});
        const complete=(result:any)=>{site.store.assertTask();site.updateJob(payload.jobId,{status:'complete',message:'导入处理已完成。',result});};
        const result=payload.payload.sourceId
          ?await imports.executeImportSource(site,payload.payload.sourceId,options,progress,complete)
          :await (await import('./wordpress-wxr.ts')).importWordPressWxr(site,{file:payload.payload.sourcePath},options,progress);
        if(site.job(payload.jobId).status!=='complete')complete(result);return result;
      } finally {
        if(previousId===undefined)delete process.env.WEAVA_JOB_ID;else process.env.WEAVA_JOB_ID=previousId;
        if(previousRoot===undefined)delete process.env.WEAVA_JOB_ROOT;else process.env.WEAVA_JOB_ROOT=previousRoot;
      }
    }
    if(operation==='seo-audits')return (await import('./seo-audit.ts')).seoAudits(site);
    if(operation==='legacy-media-stage')return (await import('./legacy-media-upload.ts')).decodeLegacyMediaUpload(site,payload.path);
    if(operation==='content-command'){
      const previousId=process.env.WEAVA_JOB_ID,previousRoot=process.env.WEAVA_JOB_ROOT;
      process.env.WEAVA_JOB_ID=payload.jobId;process.env.WEAVA_JOB_ROOT=site.root;
      try{
        site.store.assertTask();
        if(['schedule-create','plan-save'].includes(payload.operation))return await (await import('./content-mutations.ts')).executeContentMutation(site,undefined,payload.operation,payload.payload,payload.jobId);
        const media=await import('./media.ts');
        if(payload.operation==='media-edit')return await media.cropMedia(site,payload.payload.id,payload.payload.revision,payload.payload.crop);
        if(payload.operation==='media-variant')return await (await import('./image-variants.ts')).imageVariant(site,payload.payload);
      }finally{
        if(previousId===undefined)delete process.env.WEAVA_JOB_ID;else process.env.WEAVA_JOB_ID=previousId;
        if(previousRoot===undefined)delete process.env.WEAVA_JOB_ROOT;else process.env.WEAVA_JOB_ROOT=previousRoot;
      }
    }
    if(operation==='media-references')return (await import('./media.ts')).mediaReferences(site,payload.id);
    if(operation==='media-delete-preview')return (await import('./media-deletion.ts')).previewMediaDeletion(site,payload.id);
    if(operation==='storage-usage')return (await import('./maintenance.ts')).storageUsage(site);
    if(operation==='archive-plan'){
      const plan=(await import('./history-archive.ts')).planHistoryArchive(site,payload);
      return {options:plan.options,releases:plan.releaseIds.length,revisions:plan.revisions.length,protectedReleases:plan.protectedReleases,protectedRevisions:plan.protectedRevisions,review:plan.review};
    }
    if(operation==='archive-contents')return (await import('./history-archive.ts')).historyArchiveContents(site,payload.id,payload);
    const {manager}=await content();
    const {preparePublication,savePublicationReview,primePublication,readPublicationCandidate,commitPublication}=await import('./publication.ts');
    if(operation==='publication-warm'){
      primePublication(site);
      return {ready:true,executionPid:process.pid};
    }
    if(operation==='publication-publish'){
      const {jobId,deadlineAt,...options}=payload;
      const previousId=process.env.WEAVA_JOB_ID,previousRoot=process.env.WEAVA_JOB_ROOT;
      process.env.WEAVA_JOB_ID=jobId;process.env.WEAVA_JOB_ROOT=site.root;
      const started=performance.now(),timings:Record<string,number>={};
      const log=(value:unknown)=>{try{appendFileSync(join(root,'logs',jobId+'.log'),JSON.stringify(value)+'\n');}catch(error){console.error('发布日志写入失败',error);}};
      try{
        site.store.assertTask();site.updateJob(jobId,{message:'正在提交发布版本'});
        log({time:new Date().toISOString(),operation:'publish',executionPid:process.pid});
        let result:any;
        if(options.planId)result=await (await import('./publication-plans.ts')).runPublicationPlan(site,options.planId,options.planRevision,release=>manager.validateRelease(release),options.options,jobId);
        else if(options.scheduleId){
          const release=await (await import('./schedules.ts')).runScheduledPublication(site,options.scheduleId,options.scheduleRevision,release=>manager.validateRelease(release),Date.now(),jobId);
          result=release?{releaseId:release.id,entries:release.entries.length}:{skipped:true};
        }else{
          let at=performance.now();const prepared=readPublicationCandidate(site,options);timings.candidateMs=performance.now()-at;
          at=performance.now();await manager.validateRelease(prepared.release);timings.extensionsMs=performance.now()-at;
          at=performance.now();const release=commitPublication(site,prepared,{...options,jobId});timings.commitMs=performance.now()-at;
          result={releaseId:release.id,entries:release.entries.length};
        }
        timings.totalMs=performance.now()-started;
        result={...result,executionPid:process.pid,timings};site.updateJob(jobId,{status:'complete',message:'发布已完成。',result});log({time:new Date().toISOString(),status:'complete',...result});return result;
      }catch(error:any){log({time:new Date().toISOString(),status:'failed',message:String(error.message).slice(0,2000)});throw error;
      }finally{
        if(previousId===undefined)delete process.env.WEAVA_JOB_ID;else process.env.WEAVA_JOB_ID=previousId;
        if(previousRoot===undefined)delete process.env.WEAVA_JOB_ROOT;else process.env.WEAVA_JOB_ROOT=previousRoot;
      }
    }
    if(operation==='publication-review'){
      const start=performance.now(),prepared=preparePublication(site,payload),afterPrepare=performance.now();await manager.validateRelease(prepared.release);
      const afterExtensions=performance.now(),review=savePublicationReview(site,payload,prepared);
      return {...review,timings:{prepareMs:afterPrepare-start,extensionsMs:afterExtensions-afterPrepare,candidateMs:performance.now()-afterExtensions,totalMs:performance.now()-start}};
    }
    if(operation==='publication-plan-review'){
      const {planOptions}=await import('./publication-plans.ts');
      const row=site.store.get('publication-plan',payload.id);
      if(!row||row.revision!==payload.revision||!['draft','scheduled','failed'].includes(row.value.status))throw new WeavaError('计划已变化，请重新载入。',409);
      const options=planOptions(site,row.value),prepared=preparePublication(site,options);await manager.validateRelease(prepared.release);
      return {plan:row,review:savePublicationReview(site,options,prepared)};
    }
    throw new WeavaError('未知计算操作：'+operation);
  };
  const stop=async()=>{if(stopping)return;stopping=true;imports?.closePreparedImports();await manager?.stop();analytics?.close();site?.close();if(process.connected)process.disconnect();};
  process.on('message',(message:any)=>{
    if(message?.type==='stop'){queue=queue.then(stop);return;}
    if(message?.type!=='run'||stopping)return;
    queue=queue.then(async()=>{
      try{const value=await execute(message.operation,message.payload);if(process.connected)process.send!({type:'result',id:message.id,value});}
      catch(error:any){
        if(message.payload?.jobId)try{appendFileSync(join(root,'logs',message.payload.jobId+'.log'),String(error.stack??error.message).slice(-8192)+'\n');}catch{}
        if(process.connected)process.send!({type:'result',id:message.id,error:{message:error.message,status:error.status??500,details:error.details}});
      }
    });
  });
  process.once('disconnect',()=>{void queue.then(stop);});
  process.send?.({type:'ready'});
}
