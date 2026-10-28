import { Site } from './site.ts';
import { extension } from './extensions.ts';
import { Analytics } from './analytics.ts';
import { renderEntryTemplate, renderSharedRegion } from './render.ts';
import { VERSION } from '@weava/contracts';
const root=process.argv[2];let site:Site|undefined,analytics:Analytics|undefined;
try{
  site=new Site(root);analytics=new Analytics(root);const manager=await extension(site,{analytics},{mode:'worker'});
  const failed=manager.status().filter((row)=>row.enabled&&row.status!=='active');if(failed.length)throw new Error(failed.map((row)=>row.id+'：'+row.error).join('；'));
  const release=site.release();let rendered=0;
  if(release){site.validateReleaseExtensions(release);for(const entry of release.entries){renderEntryTemplate(entry,release,manager.blocks,{strict:true});await manager.render(entry,release);for(const key of ['header','before','after','footer'] as const)renderSharedRegion(key,release,entry,manager.blocks,{strict:true});rendered++;}}
  if(site.store.raw.pragma('integrity_check',{simple:true})!=='ok')throw new Error('数据库完整性检查失败。');
  console.log(JSON.stringify({ok:true,framework:VERSION,releaseId:release?.id??null,entries:rendered,extensions:manager.status().map(({backup,...row})=>row)}));await manager.stop();
}catch(error:any){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}finally{analytics?.close();site?.close();}
