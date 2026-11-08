import {afterEach, expect, it} from 'vitest';
import {join, resolve} from 'node:path';
import {Site, JobRunner, savePublicationPlan, runPublicationPlan, reviewPublicationPlan, queueScheduledPublications, schedulePublication} from '@weava/core';
import {entrySchema, WeavaError} from '@weava/contracts';
import Database from 'better-sqlite3';
import {duePublications} from '../packages/core/src/publication-time.ts';
import {migrateStorage} from '../packages/core/src/storage-migrations.ts';

const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','publication-scheduler-'+Date.now());
const sites:Site[]=[], runners:JobRunner[]=[];
let sequence=0;
function create(){const site=new Site(join(base,String(sequence++)));sites.push(site);return site;}
function runner(site:Site,paused=false){const jobs=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:paused});runners.push(jobs);return jobs;}
function entry(site:Site,id:string){return site.saveEntry(entrySchema.parse({id,kind:'page',title:id,path:'/'+id+'/'}),null);}
afterEach(()=>{runners.splice(0).forEach(jobs=>jobs.stop());sites.splice(0).forEach(site=>site.close());});
it('runs a reviewed plan after unrelated media and draft edits without bypassing selected-content checks',async()=>{
 const site=create(),row=entry(site,'planned'),other=entry(site,'other');site.publish({ids:[row.id]});
 const plan=savePublicationPlan(site,{id:'reviewed-plan',name:'Plan',actions:[{id:row.id,revision:row.revision,action:'publish'}]},null);
 const checked=reviewPublicationPlan(site,plan.id,plan.revision);
 site.store.put('media-group','unrelated',{name:'Unrelated'},null);site.saveEntry({...other.value,title:'Unrelated edit'},other.revision);
 const result=await runPublicationPlan(site,plan.id,plan.revision,async()=>{},checked.review.options);expect(result.releaseId).toBe(site.release()!.id);
});
it('backfills due timestamps for an existing version 14 site without changing authored revisions',()=>{
 const site=create(),row=entry(site,'migrated'),time='2030-01-01T08:00:00+08:00';
 const scheduled=schedulePublication(site,row.id,row.revision,time,Date.parse('2029-01-01'));
 site.store.raw.exec('DROP TABLE publication_due; DROP TABLE archived_publication_objects; DROP TABLE staged_requests; ALTER TABLE media_uploads DROP COLUMN sha256; ALTER TABLE media_uploads DROP COLUMN verified; DELETE FROM schema_migrations WHERE version=15');
 migrateStorage(site.store.raw,site.root,14);
 expect(duePublications(site.store,['publication-schedule'],Date.parse('2030-01-01T00:00:00Z'),10)).toEqual([{scope:'publication-schedule',id:scheduled.id,revision:scheduled.revision}]);
 expect(site.store.get('publication-schedule',scheduled.id)?.revision).toBe(scheduled.revision);
 expect(site.store.raw.pragma('table_info(media_uploads)')).toEqual(expect.arrayContaining([expect.objectContaining({name:'sha256'}),expect.objectContaining({name:'verified'})]));
});
it('uses a timestamp range index when thousands of plans are all in the future',()=>{
 const db=new Database(':memory:');try{
  db.exec('CREATE TABLE publication_due(scope TEXT,id TEXT,revision INTEGER,due_at INTEGER,PRIMARY KEY(scope,id));CREATE INDEX publication_due_time ON publication_due(due_at,scope,id)');
  const insert=db.prepare('INSERT INTO publication_due VALUES(?,?,?,?)');db.transaction(()=>{for(let i=0;i<5000;i++)insert.run('publication-plan',String(i),i,4102444800000);})();
  expect(duePublications({raw:db} as any,['publication-plan','publication-schedule'],Date.now(),1)).toEqual([]);
  const explain=db.prepare("EXPLAIN QUERY PLAN SELECT scope,id,revision FROM publication_due INDEXED BY publication_due_time WHERE scope IN ('publication-plan','publication-schedule') AND due_at<=? ORDER BY due_at,scope,id LIMIT 1").all(Date.now()) as {detail:string}[];
  expect(explain.some(row=>row.detail.includes('publication_due_time (due_at<?)'))).toBe(true);expect(explain.some(row=>row.detail.includes('TEMP B-TREE'))).toBe(false);
 }finally{db.close();}
});

it.each(['republished','withdrawn'] as const)('WVA-01 stops a %s withdrawal and drains later plans and schedules through the worker',async mode=>{
  const site=create(), old=entry(site,'old'), next=entry(site,'next'), last=entry(site,'last'), clock=Date.now();
  site.publish({ids:[old.id]});
  const stale=savePublicationPlan(site,{id:'stale',name:'旧版本撤下',dueAt:new Date(clock-3000).toISOString(),actions:[{id:old.id,revision:old.revision,action:'withdraw'}]},null,clock-10000);
  const plan=savePublicationPlan(site,{id:'next',name:'后续批次',dueAt:new Date(clock-2000).toISOString(),actions:[{id:next.id,revision:next.revision,action:'publish'}]},null,clock-10000);
  const scheduled=schedulePublication(site,last.id,last.revision,new Date(clock-1000).toISOString(),clock-10000);
  if(mode==='republished'){
    site.saveEntry({...old.value,title:'新的公开版本'},old.revision);site.publish({ids:[old.id]});
  }else site.publish({scope:'entries',withdrawIds:[old.id]});
  const previous=site.release()!.id, jobs=runner(site);
  queueScheduledPublications(site,jobs);
  const failed=site.jobs()[0];
  await expect(jobs.wait(failed.id,15000)).rejects.toMatchObject({status:409});
  expect(site.store.get('publication-plan',stale.id)!.value).toMatchObject({status:'failed',attempts:1,error:expect.stringContaining('撤下')});
  expect(site.release()!.id).toBe(previous);
  for(const expected of [{planId:plan.id},{scheduleId:scheduled.id}]){
    queueScheduledPublications(site,jobs);
    const job=site.jobs()[0];expect(job.payload).toMatchObject(expected);await jobs.wait(job.id,15000);
  }
  expect(site.store.get('publication-plan',plan.id)!.value.status).toBe('complete');
  expect(site.store.get('publication-schedule',scheduled.id)!.value.status).toBe('complete');
  const published=site.release()!.entries;
  expect(published.find(item=>item.id===next.id)?.revisionId).toBe(next.revision);
  expect(published.find(item=>item.id===last.id)?.revisionId).toBe(last.revision);
  if(mode==='republished')expect(published.find(item=>item.id===old.id)?.title).toBe('新的公开版本');
  else expect(published.some(item=>item.id===old.id)).toBe(false);
  const count=site.jobs().length;
  for(let tick=0;tick<3;tick++)queueScheduledPublications(site,jobs);
  expect(site.jobs()).toHaveLength(count);
},45000);

it('WVA-01 retries a changed render snapshot but terminates an unrecoverable renderer conflict',async()=>{
  const site=create(), row=entry(site,'one');
  const plan=savePublicationPlan(site,{id:'retry',name:'重试',dueAt:new Date(Date.now()+10000).toISOString(),actions:[{id:row.id,revision:row.revision,action:'publish'}]},null);
  await expect(runPublicationPlan(site,plan.id,plan.revision,async()=>{site.saveEntry({...row.value,title:'新工作稿'},row.revision);})).rejects.toMatchObject({status:409});
  expect(site.store.get('publication-plan',plan.id)!.value.status).toBe('scheduled');
  await runPublicationPlan(site,plan.id,plan.revision,async()=>{});
  expect(site.release()!.entries.find(item=>item.id===row.id)?.title).toBe('one');
  const blocked=savePublicationPlan(site,{id:'blocked',name:'需要处理',dueAt:new Date(Date.now()+10000).toISOString(),actions:[{id:row.id,revision:row.revision,action:'publish'}]},null);
  await expect(runPublicationPlan(site,blocked.id,blocked.revision,async()=>{throw new WeavaError('渲染配置需要人工处理',409);})).rejects.toThrow('人工处理');
  expect(site.store.get('publication-plan',blocked.id)!.value.status).toBe('failed');
});

const times=['2030-01-01T02:00:00.000Z','2030-01-01T10:00:00+08:00','2029-12-31T21:00:00-05:00','Tue, 01 Jan 2030 10:00:00 +0800'];
it.each(times)('WVA-02 normalizes a new plan time %s',dueAt=>{
  const site=create(), row=entry(site,'one');
  const plan=savePublicationPlan(site,{id:'time',name:'时区',dueAt,actions:[{id:row.id,revision:row.revision,action:'publish'}]},null,Date.parse('2029-01-01'));
  expect(plan.value.dueAt).toBe('2030-01-01T02:00:00.000Z');
});
it.each(times)('WVA-02 selects a persisted legacy time %s at its actual instant after reopening',dueAt=>{
  const site=create(), row=entry(site,'one'), instant=Date.parse(dueAt);
  const plan=savePublicationPlan(site,{id:'time',name:'旧计划',dueAt,actions:[{id:row.id,revision:row.revision,action:'publish'}]},null,instant-10000);
  // Before WVA-02 the public save operation persisted the accepted string verbatim.
  // Preserve that exact record representation even when the new writer normalizes it.
  site.store.put('publication-plan',plan.id,{...plan.value,dueAt},plan.revision);
  const reopened=new Site(site.root);sites.push(reopened);const jobs=runner(reopened,true);
  queueScheduledPublications(reopened,jobs,instant-1);expect(reopened.jobs()).toHaveLength(0);
  queueScheduledPublications(reopened,jobs,instant);expect(reopened.jobs()).toHaveLength(1);
  expect(reopened.jobs()[0].payload).toMatchObject({planId:plan.id});
});

it('WVA-02 orders mixed legacy offsets by time rather than their textual date',()=>{
  const site=create(), row=entry(site,'one'), clock=Date.parse('2030-01-01T11:00:00Z');
  for(const [id,dueAt] of [['earlier','2030-01-01T10:00:00+08:00'],['later','2030-01-01T03:00:00Z']]){
    const plan=savePublicationPlan(site,{id,name:id,dueAt,actions:[{id:row.id,revision:row.revision,action:'publish'}]},null,clock-86400000);
    site.store.put('publication-plan',id,{...plan.value,dueAt},plan.revision);
  }
  queueScheduledPublications(site,runner(site,true),clock);
  expect(site.jobs()[0].payload.planId).toBe('earlier');
});
