import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {Site,planHistoryArchive,archiveHistory,restoreHistoryArchive} from '@weava/core';
import {entrySchema} from '@weava/contracts';
const output='D:/Tools/cache/weava/growth-'+Date.now();mkdirSync(output,{recursive:true});const site=new Site(join(output,'site'));
const stats=()=>({objects:site.store.raw.prepare('SELECT kind,COUNT(*) count,SUM(LENGTH(CAST(data AS BLOB))) bytes FROM publication_objects GROUP BY kind').all() as any[],search:(site.store.raw.prepare('SELECT COUNT(*) n FROM publication_fts').get() as any).n,releases:(site.store.raw.prepare('SELECT COUNT(*) n,SUM(LENGTH(CAST(data AS BLOB))) bytes FROM releases').get() as any)});
try{
  site.saveType({id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article'},null);const text='用于观察发布对象复用的正文。'.repeat(500);
  for(let index=0;index<200;index++)site.saveEntry(entrySchema.parse({id:'entry-'+index,kind:'content',type:'post',title:'文章 '+index,path:'/posts/'+index+'/',status:'published',document:{version:1,format:'markdown',source:text}}),null);
  site.publish();const baseline=stats(),timings:number[]=[];
  for(let index=0;index<30;index++){const settings=site.settings();site.saveSettings({...settings.value,name:'站名 '+index},settings.revision);const start=performance.now();site.publish({scope:'settings'});timings.push(performance.now()-start);}
  const repeated=stats();assert.equal(repeated.objects.find((row)=>row.kind==='entry').count,200);assert.equal(repeated.search,baseline.search);assert.equal(repeated.releases.n,31);
  const entry=site.store.get('entry','entry-0')!;site.saveEntry({...entry.value,document:{version:1,format:'markdown',source:'独立新正文'}},entry.revision);site.publish({ids:[entry.id]});const changed=stats();assert.equal(changed.objects.find((row)=>row.kind==='entry').count,201);assert.equal(changed.search,201);
  const releaseId=site.release()!.id,plan=planHistoryArchive(site,{before:'2099-01-01',keepReleases:2,keepRevisions:2}),archive=await archiveHistory(site,plan.options,plan.review),archived=stats();assert.equal(archived.releases.n,2);assert.equal(site.search('独立新正文')[0].id,'entry-0');assert.equal(site.release()!.id,releaseId);
  restoreHistoryArchive(site,archive.id!);assert.equal(stats().releases.n,32);assert.equal(site.release()!.id,releaseId);
  timings.sort((a,b)=>a-b);const result={output,entries:200,settingsPublications:30,baseline,repeated,changed,archived,publishMilliseconds:{p50:Math.round(timings[15]),p95:Math.round(timings[28])},entryObjectsAddedBySettings:0,searchDocumentsAddedBySettings:0,archiveRestoredWithoutChangingPublic:true,passed:true};writeFileSync(join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{site.close();}
