import { Site } from './site.ts';
import { extension } from './extensions.ts';
import { Analytics } from './analytics.ts';
import { renderEntryTemplate, renderSharedRegion } from './render.ts';
import { VERSION } from '@weava/contracts';
import { BusinessStore } from './site-sdk.ts';
import { siteFeatures } from './site-features.ts';
import { migrateWebsite } from './site-migrations.ts';
import { loadSiteRenderer } from './site-render.ts';
import { websiteContext, withWebsite } from './site-sdk.ts';
import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
const root=process.argv[2];let site:Site|undefined,analytics:Analytics|undefined;
try{
  site=new Site(root,{mode:'migrate'});if(siteFeatures(root).includes('analytics'))analytics=new Analytics(root,{mode:'migrate'});const business=new BusinessStore(root,'migrate');business.close();const manager=await extension(site,analytics?{analytics}:{},{mode:'worker',migrate:true});
  const pointer=existsSync(join(root,'program.json'))?JSON.parse(readFileSync(join(root,'program.json'),'utf8')):null;
  const renderer=await loadSiteRenderer(root);
  await migrateWebsite(root,pointer?.siteBuildId);
  const failed=manager.status().filter((row)=>row.enabled&&row.status!=='active');if(failed.length)throw new Error(failed.map((row)=>row.id+'：'+row.error).join('；'));
  const release=site.release();let rendered=0;
  if(release){site.validateReleaseExtensions(release);if(process.env.WEAVA_SKIP_RENDER!=='1')for(const entry of release.entries){renderEntryTemplate(entry,release,manager.blocks,{strict:true});await manager.render(entry,release);for(const key of ['header','before','after','footer'] as const)renderSharedRegion(key,release,entry,manager.blocks,{strict:true});rendered++;}}
  if(renderer&&process.env.WEAVA_SKIP_RENDER!=='1'){
    const data=new BusinessStore(root);
    try{for(const entry of release?.entries??[]){const request=new Request(new URL(entry.path,'http://127.0.0.1'));const response=await renderer.render(request,websiteContext(site,data,{enqueue(){throw new Error('预检不执行持久任务。');}},request,true,entry));if(response&&response.status>=500)throw new Error('网站专用页面渲染失败：'+entry.path);}}
    finally{data.close();}
  }
  if(site.store.raw.pragma('integrity_check',{simple:true})!=='ok')throw new Error('数据库完整性检查失败。');
  console.log(JSON.stringify({ok:true,framework:VERSION,releaseId:release?.id??null,entries:rendered,migrationFiles:manager.migrationFiles,extensions:manager.status().map(({backup,...row})=>row)}));await manager.stop();
}catch(error:any){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}finally{analytics?.close();site?.close();}
