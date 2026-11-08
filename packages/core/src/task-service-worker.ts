import type { Site } from './site.ts';
import type { Analytics } from './analytics.ts';
import type { extension } from './extensions.ts';
import { WeavaError } from '../../contracts/src/errors.ts';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import {siteFeatures} from './site-features.ts';

export function serveTasks(root:string) {
  let site:Site|undefined, analytics:Analytics|undefined, manager:Awaited<ReturnType<typeof extension>>|undefined;
  let extensionKey='';
  let stopping=false;
  let queue=Promise.resolve();
  let usage:{at:number;generation:number;value:any}|undefined;
  const stats=async()=>analytics??=new (await import('./analytics.ts')).Analytics(root);
  const content=async()=>{
    const {Site}=await import('./site.ts'),{walk,digest}=await import('./storage.ts'),{extension}=await import('./extensions.ts');
    site??=new Site(root);
    const key=digest([site.store.raw.prepare("SELECT scope,id,revision FROM records WHERE scope LIKE 'extension%' ORDER BY scope,id").all(),
      walk(join(root,'extensions')).map(file=>{const info=statSync(file);return[file,info.size,info.mtimeMs];})]);
    if(manager&&key!==extensionKey){await manager.stop();site.close();site=new Site(root);manager=undefined;}
    if(!manager){const analytics=siteFeatures(root).includes('analytics')?await stats():undefined;manager=await extension(site,analytics?{analytics}:{},{mode:'worker'});extensionKey=key;}
    return {site,manager};
  };
  const execute=async(operation:string,payload:any)=>{
    if(operation.startsWith('analytics-')){
      const analytics=await stats(),params=new URLSearchParams(payload.query);
      if(operation==='analytics-report')return analytics.report(params,payload.timezone);
      if(operation==='analytics-realtime')return analytics.realtime(params);
      if(operation==='analytics-visitor')return analytics.visitor(payload.id,params,payload.timezone);
      if(operation==='analytics-export')return analytics.export(params,payload.timezone);
    }
    const {site,manager}=await content();
    if(operation==='seo-audits')return (await import('./seo-audit.ts')).seoAudits(site);
    if(operation==='legacy-media-stage')return (await import('./legacy-media-upload.ts')).decodeLegacyMediaUpload(site,payload.path);
    const {preparePublication,savePublicationReview,readPublicationCandidate}=await import('./publication.ts');
    if(operation==='publication-review'){
      const prepared=preparePublication(site,payload);await manager.validateRelease(prepared.release);
      return savePublicationReview(site,payload,prepared);
    }
    if(operation==='publication-plan-review'){
      const {planOptions}=await import('./publication-plans.ts');
      const row=site.store.get('publication-plan',payload.id);
      if(!row||row.revision!==payload.revision||!['draft','scheduled','failed'].includes(row.value.status))throw new WeavaError('计划已变化，请重新载入。',409);
      const options=planOptions(site,row.value),prepared=preparePublication(site,options);await manager.validateRelease(prepared.release);
      return {plan:row,review:savePublicationReview(site,options,prepared)};
    }
    if(operation==='media-references')return (await import('./media.ts')).mediaReferences(site,payload.id);
    if(operation==='storage-usage'){
      return (await import('./maintenance.ts')).storageUsage(site);
    }
    if(operation==='archive-plan'){
      const plan=(await import('./history-archive.ts')).planHistoryArchive(site,payload);
      return {options:plan.options,releases:plan.releaseIds.length,revisions:plan.revisions.length,protectedReleases:plan.protectedReleases,protectedRevisions:plan.protectedRevisions,review:plan.review};
    }
    if(operation==='archive-contents')return (await import('./history-archive.ts')).historyArchiveContents(site,payload.id);
    throw new WeavaError('未知计算操作：'+operation);
  };
  const stop=async()=>{if(stopping)return;stopping=true;await manager?.stop();analytics?.close();site?.close();if(process.connected)process.disconnect();};
  process.on('message',(message:any)=>{
    if(message?.type==='stop'){queue=queue.then(stop);return;}
    if(message?.type!=='run'||stopping)return;
    queue=queue.then(async()=>{
      try{const value=await execute(message.operation,message.payload);if(process.connected)process.send!({type:'result',id:message.id,value});}
      catch(error:any){if(process.connected)process.send!({type:'result',id:message.id,error:{message:error.message,status:error.status??500,details:error.details}});}
    });
  });
  process.once('disconnect',()=>{void queue.then(stop);});
  process.send?.({type:'ready'});
}
