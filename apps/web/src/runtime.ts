import {Site,Analytics,Engagement,atomicJson,now,extension,queueScheduledPublications,JobRunner,TaskResults} from '@weava/core';
import {join,resolve} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {siteFeatures} from '../../../packages/core/src/site-features.ts';
import {BusinessStore,websiteContext} from '../../../packages/core/src/site-sdk.ts';
import {loadSiteRenderer} from '../../../packages/core/src/site-render.ts';
import {migrateWebsite} from '../../../packages/core/src/site-migrations.ts';
import {readJobLog} from '../../../packages/core/src/job-logs.ts';
import {httpRequests} from '../../../packages/core/src/http-lifecycle.ts';
const root=resolve(process.env.WEAVA_SITE??resolve(process.env.WEAVA_FRAMEWORK??process.cwd(),'../WeavaSites/demo'));
const runtimeFile=join(root,'runtime.json');
if(existsSync(runtimeFile)){
 const old=JSON.parse(readFileSync(runtimeFile,'utf8'));let alive=false;
 if(old.status!=='stopped'&&old.pid!==process.pid){try{process.kill(old.pid,0);alive=true;}catch{}if(alive)throw new Error('这个站点已经由另一个进程运行。');}
}
export const site=new Site(root);
export const features=siteFeatures(root);
let actualAnalytics:Analytics|undefined;
export const analytics=new Proxy({} as Analytics,{get(_target,key){
 if(!features.includes('analytics'))throw new Error('网站没有启用访问统计。');
 actualAnalytics??=new Analytics(root);
 const value=(actualAnalytics as any)[key];return typeof value==='function'?value.bind(actualAnalytics):value;
}});
export const engagement=new Engagement(site.store.raw,site.engagementSecret());
export const jobs=new JobRunner(site,{framework:process.env.WEAVA_PROGRAM_ROOT??process.env.WEAVA_FRAMEWORK??process.cwd(),worker:process.env.WEAVA_WORKER,source:process.env.WEAVA_SOURCE_WORKER==='1'||import.meta.env.MODE==='development'});
export const reports=new TaskResults(jobs);
let actualBusiness:BusinessStore|undefined;
export const business=new Proxy({} as BusinessStore,{get(_target,key){actualBusiness??=new BusinessStore(root);const value=(actualBusiness as any)[key];return typeof value==='function'?value.bind(actualBusiness):value;}});
export let maintenance=process.env.WEAVA_VALIDATION==='1';
export let validating=process.env.WEAVA_VALIDATION==='1';
export const siteExtension=extension(site,features.includes('analytics')?{analytics}:{});
export const siteRenderer=loadSiteRenderer(root).then(async renderer=>{const file=join(root,'program.json');if(existsSync(file))await migrateWebsite(root,JSON.parse(readFileSync(file,'utf8')).siteBuildId,'open');return renderer;});
export const contextFor=(request:Request,preview=false,entry?:any)=>websiteContext(site,business,{enqueue:jobs.enqueue.bind(jobs),get:site.job.bind(site),log:(id,offset)=>{site.job(id);return readJobLog(join(site.root,'logs',id+'.log'),offset);}},request,preview,entry,validating&&!!process.env.WEAVA_UPGRADE_PROBE&&request.headers.get('x-weava-upgrade-probe')===process.env.WEAVA_UPGRADE_PROBE);
const state={pid:process.pid,status:'starting',startedAt:now(),port:Number(process.env.PORT??4322),nonce:process.env.WEAVA_RUN_NONCE??'',programId:process.env.WEAVA_PROGRAM_ID??''};
export let ready=false;
const initialization=Promise.all([siteExtension,siteRenderer]).then(async([manager])=>{
 const failed=manager.status().filter(row=>row.enabled&&row.status!=='active');
 if(failed.length)throw new Error(failed.map(r=>r.id+'：'+r.error).join('；'));
 if(features.includes('analytics')){actualAnalytics=new Analytics(root);if(!validating)void actualAnalytics.geo.update(false).catch(()=>{});}
 await manager.pause(maintenance);
 if(!maintenance)site.recoverJobs();
 ready=true;jobs.pause(maintenance);if(!maintenance)jobs.pump();atomicJson(runtimeFile,{...state,status:'running'});
});
void initialization.catch(error=>{console.error('网站初始化失败',error);process.exitCode=1;setTimeout(()=>process.exit(1),10);});
atomicJson(runtimeFile,state);
const tick=async()=>{if(maintenance||!ready)return;site.recoverJobs();jobs.pump();if(features.includes('content'))queueScheduledPublications(site,jobs);};
const watch=setInterval(()=>{void tick().catch(e=>console.error(e));},5000);watch.unref();
const geoWatch=setInterval(()=>{if(!maintenance&&actualAnalytics)void actualAnalytics.geo.update(false).catch(()=>{});},86400000);geoWatch.unref();
let stopping=false;
async function shutdown(){
 if(stopping)return;stopping=true;clearInterval(watch);clearInterval(geoWatch);jobs.stop();
 try{await (await siteExtension).stop();actualAnalytics?.close();actualBusiness?.close();site.close();}
 catch(e){console.error('网站关闭失败',e);}
 atomicJson(runtimeFile,{...state,status:'stopped'});process.exit(0);
}
process.on('message',(message:any)=>{
 if(message?.type!=='weava-control')return;
 const answer=(value?:unknown,error?:string)=>process.send?.({controlId:message.controlId,value,error});
 if(message.action==='shutdown'){void shutdown();return;}
 if(message.action==='initialize'){void initialization.then(async()=>{await(await siteExtension).initialize();answer({initialized:true});}).catch(e=>answer(undefined,e.message));return;}
 if(message.action==='resume'){void initialization.then(async()=>{await(await siteExtension).pause(false);validating=false;maintenance=false;jobs.pause(false);answer({resumed:true});}).catch(e=>answer(undefined,e.message));return;}
 if(message.action==='drain')void (async()=>{
  maintenance=true;jobs.pause(true);const manager=await siteExtension;await manager.pause(true);
  const until=Date.now()+(message.timeoutMs??300000);
  while(Date.now()<until){
   const count=(site.store.raw.prepare("SELECT COUNT(*) n FROM jobs WHERE status='running'").get() as {n:number}).n;
   if(!count&&!httpRequests.pending&&!manager.pendingTasks&&!jobs.pendingQueries){
    jobs.stopQueries();
    while(jobs.queryProcessCount&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
    if(!jobs.queryProcessCount){answer({drained:true});return;}
   }
   await new Promise(r=>setTimeout(r,100));
  }
  await manager.pause(false);maintenance=false;jobs.pause(false);answer(undefined,'仍有任务运行，已恢复网站服务，未切换版本。');
 })().catch(e=>answer(undefined,e.message));
});
process.once('disconnect',()=>{void shutdown();});
process.once('SIGTERM',()=>{void shutdown();});process.once('SIGINT',()=>{void shutdown();});
process.once('exit',()=>{if(!stopping)atomicJson(runtimeFile,{...state,status:'stopped'});});
