import { expect, it,vi } from 'vitest';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import {spawn} from 'node:child_process';
import {entrySchema} from '@weava/contracts';
import { JobRunner, Site, readJsonBody, Analytics } from '@weava/core';
import {createAdminDispatcher} from '../apps/web/src/api/dispatch.ts';
import {executeContentMutation} from '../packages/core/src/content-mutations.ts';
const base=(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/job-runner-'+Date.now();
it('runs backups exclusively and tolerates a backup write reservation during its heartbeat',async()=>{
  const site=new Site(join(base,'backup-reservation')),locker=new Site(site.root),runner=new JobRunner(site,{framework:resolve('.'),source:true});
  let finish!:(value:any)=>void;
  const background=vi.spyOn((runner as any).background,'run').mockImplementation(()=>new Promise(resolve=>finish=resolve));
  const publish=vi.spyOn((runner as any).publication,'run').mockResolvedValue({releaseId:'fixture'});
  try{
    const backup=runner.enqueue('backup',{}),publication=runner.enqueue('publish',{});
    runner.pause(false);runner.pump();expect(background).toHaveBeenCalledTimes(1);expect(publish).not.toHaveBeenCalled();expect(site.job(publication.id).status).toBe('queued');
    locker.store.raw.exec('BEGIN IMMEDIATE');const started=Date.now();
    await new Promise(resolve=>setTimeout(resolve,1100));expect(Date.now()-started).toBeLessThan(2000);expect(site.job(backup.id).status).toBe('running');
    locker.store.raw.exec('ROLLBACK');finish({path:'fixture'});
    await runner.wait(backup.id,2000);await runner.wait(publication.id,2000);expect(publish).toHaveBeenCalledTimes(1);
  }finally{if(locker.store.raw.inTransaction)locker.store.raw.exec('ROLLBACK');finish?.({});await runner.stop();background.mockRestore();publish.mockRestore();locker.close();site.close();}
});
it('runs the nearest scheduled publication at its deadline without waiting for a five-second sweep',async()=>{
 const site=new Site(join(base,'nearest-schedule')),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false,schedulePublications:true});
 try{
  const row=site.saveEntry(entrySchema.parse({id:'due',kind:'page',title:'Due',path:'/due/'}),null),due=Date.now()+300;
  const {schedulePublication}=await import('../packages/core/src/schedules.ts');
  const schedule=schedulePublication(site,row.id,row.revision,new Date(due).toISOString());
  const run=(await import('vitest')).vi.spyOn((runner as any).publication,'run');
  // Observe dispatch independently of cold renderer startup; commit behavior is covered by publication tests.
  run.mockImplementation(()=>new Promise(()=>{}));
  runner.refreshSchedule();
  while(Date.now()<due+800&&!run.mock.calls.length)await new Promise(resolve=>setTimeout(resolve,10));
  expect(run).toHaveBeenCalledTimes(1);expect(Date.now()-due).toBeLessThan(800);
  expect(site.job((run.mock.calls[0][1] as any).jobId).operation).toBe('publish');run.mockRestore();
 }finally{runner.stop();site.close();}
});
it('dispatches a reused executor only after the outer transaction makes its task durable',async()=>{
 const site=new Site(join(base,'durable-command')),reader=new Site(site.root),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
 try{
  const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/'}),null);
  const run=(await import('vitest')).vi.spyOn((runner as any).publication,'run').mockImplementation(async(_operation,payload:any)=>{
   const committed=reader.job(payload.jobId);expect(committed.status).toBe('running');
   return executeContentMutation(reader,undefined,committed.operation,committed.payload,committed.id);
  });
  const job=site.store.raw.transaction(()=>{const created=runner.command('entry-delete',{id:row.id,revision:row.revision});expect(run).not.toHaveBeenCalled();return created;}).immediate();
  expect(await runner.wait(job.id,1000)).toEqual({id:row.id});expect(reader.store.get('entry',row.id)).toBeNull();run.mockRestore();
 }finally{runner.stop();reader.close();site.close();}
});
it('keeps an atomically committed command successful if its worker loses the result connection',async()=>{
 const site=new Site(join(base,'committed-result')),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});
 try{
  const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/'}),null);
  const run=(await import('vitest')).vi.spyOn((runner as any).service,'run').mockImplementation(async(_operation,payload:any)=>{
   const durable=site.job(payload.jobId);
   await executeContentMutation(site,undefined,durable.operation,durable.payload,durable.id);
   throw new Error('Result connection lost after commit');
  });
  const job=runner.command('schedule-create',{id:row.id,revision:row.revision,dueAt:new Date(Date.now()+60000).toISOString()});
  runner.pause(false);runner.pump();await new Promise(resolve=>setTimeout(resolve,0));
  expect(site.job(job.id).status).toBe('complete');expect((await runner.wait(job.id)).value.entryId).toBe(row.id);
  expect(runner.command('schedule-create',job.payload).id).toBe(job.id);run.mockRestore();
 }finally{runner.stop();site.close();}
});
it('dispatches plan saves, withdrawals and deletion as inspectable jobs with committed results',async()=>{
 const site=new Site(join(base,'content-commands')),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
 try{
  const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/'}),null);site.publish({ids:[row.id]});
  const dispatch=createAdminDispatcher({site,jobs:runner} as any),context={url:new URL('http://localhost'),request:new Request('http://localhost')} as any;
  const planResponse=await dispatch('savePlan',{}, {value:{id:'plan',name:'Plan',actions:[{id:row.id,revision:row.revision,action:'publish'}]},revision:null},context);
  expect(planResponse.status).toBe(202);const planJob=await planResponse.json();const plan=await runner.wait(planJob.id,15000);expect(plan.value.actions[0].id).toBe(row.id);
  await dispatch('cancelPlan',{}, {id:plan.id,revision:plan.revision},context);
  const response=await dispatch('withdraw',{}, {id:row.id,revision:row.revision},context);expect(response.status).toBe(202);
  const job=await response.json(),withdrawn=await runner.wait(job.id,15000);expect(withdrawn.value.status).toBe('draft');expect(site.release()!.entries).toHaveLength(0);
  const deleted=await dispatch('deleteEntry',{}, {id:row.id,revision:withdrawn.revision},context);expect(deleted.status).toBe(202);const deletion=await deleted.json();
  expect(await runner.wait(deletion.id,15000)).toEqual({id:row.id});expect(site.store.get('entry',row.id)).toBeNull();
  const retried=await dispatch('deleteEntry',{}, {id:row.id,revision:withdrawn.revision},context);expect((await retried.json()).id).toBe(deletion.id);
 }finally{runner.stop();site.close();}
},50000);
it('reuses active and committed commands but allows retrying a terminal failed or cancelled command',()=>{
  const site=new Site(join(base,'command-retry')),runner=new JobRunner(site,{framework:resolve('.'),source:true});
  try{
    const payload={id:'entry',revision:1,dueAt:'2099-01-01T00:00:00Z'},first=runner.command('schedule-create',payload);
    expect(runner.command('schedule-create',payload).id).toBe(first.id);
    runner.cancel(first.id);const retry=runner.command('schedule-create',payload);expect(retry.id).not.toBe(first.id);
    site.updateJob(retry.id,{status:'failed'});const next=runner.command('schedule-create',payload);expect(next.id).not.toBe(retry.id);
    site.updateJob(next.id,{status:'complete',result:{saved:true}});expect(runner.command('schedule-create',payload).id).toBe(next.id);
  }finally{runner.stop();site.close();}
});
it.each(['cancel','timeout'] as const)('stops a blocked rendering process on %s without publishing a late result',async action=>{
  const site=new Site(join(base,action)),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false,timeoutMs:action==='timeout'?8000:20000});
  try{
    const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/'}),null);
    writeFileSync(join(site.root,'extensions/index.mjs'),`export default({site})=>({id:'blocked',apiVersion:1,render(){site.store.setState('entered-render','1');while(true){}}});`);
    const job=runner.enqueue('publish',{ids:[row.id]});
    for(let n=0;n<100&&!site.store.state('entered-render');n++)await new Promise(resolve=>setTimeout(resolve,100));
    expect(site.store.state('entered-render')).toBe('1');expect(site.job(job.id).heartbeatAt).toBeGreaterThan(0);
    if(action==='cancel')runner.cancel(job.id);
    await expect(runner.wait(job.id,12000)).rejects.toThrow(action==='cancel'?/取消/:/期限/);
    expect(site.job(job.id).status).toBe(action==='cancel'?'cancelled':'failed');expect(site.release()).toBeNull();
    expect(site.activeJobs()).toEqual([]);
  }finally{runner.stop();site.close();}
},25000);
it('retries a writer lock without throwing or losing the queued job',async()=>{
 const site=new Site(join(base,'writer-lock')),runner=new JobRunner(site,{framework:resolve('.'),source:true});
 let child:ReturnType<typeof spawn>|undefined;
 try{
  const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/'}),null);
  const job=runner.command('schedule-create',{id:row.id,revision:row.revision,dueAt:new Date(Date.now()+60000).toISOString()});
  site.store.raw.pragma('busy_timeout=25');
  child=spawn(process.execPath,['--input-type=module','-e',`import Database from 'better-sqlite3';const db=new Database(process.argv[1]);db.exec('BEGIN IMMEDIATE');process.send({locked:true});setTimeout(()=>{db.exec('ROLLBACK');db.close();process.disconnect();},500);`,join(site.root,'weava.sqlite')],{cwd:resolve('.'),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  const done=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));await new Promise<void>(resolve=>child!.once('message',()=>resolve()));
  runner.pause(false);expect(()=>runner.pump()).not.toThrow();expect(site.job(job.id).status).toBe('queued');await done;
  site.store.raw.pragma('busy_timeout=5000');const result=await runner.wait(job.id,15000);
  expect(result.value.entryId).toBe(row.id);expect(site.jobs()).toHaveLength(1);
  expect(runner.command('schedule-create',job.payload).id).toBe(job.id);
  await expect(runner.query('schedule-create',job.payload)).rejects.toThrow(/未知计算操作/);
 }finally{if(child?.exitCode===null)child.kill();runner.stop();site.close();}
},25000);
it('ARC-17 bounds all task processes, deduplicates submissions and resumes persisted queued tasks',async()=>{
  const site=new Site(join(base,'site')),worker=join(base,'worker.mjs');
  writeFileSync(worker,`import{createRequire}from'node:module';const require=createRequire(${JSON.stringify(resolve('package.json'))});const Database=require('better-sqlite3');const[root,id]=process.argv.slice(2);const db=new Database(root+'/weava.sqlite');db.pragma('busy_timeout=5000');const job=JSON.parse(db.prepare('SELECT data FROM jobs WHERE id=?').get(id).data);const active=db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='running'").get().n;await new Promise(resolve=>setTimeout(resolve,250));const result={...job,status:'complete',result:{active,pid:process.pid}};db.prepare('UPDATE jobs SET status=?,data=? WHERE id=?').run('complete',JSON.stringify(result),id);db.close();`);
  const options={startPaused:false,framework:resolve('.'),worker,concurrency:2,maxQueued:8};
  let runner=new JobRunner(site,options);
  try{
    const jobs=Array.from({length:6},(_,index)=>runner.enqueue('test',{index},'job-'+index));
    expect(runner.enqueue('test',{index:0},'job-0').id).toBe(jobs[0].id);
    expect(site.activeJobs().filter(job=>job.status==='running')).toHaveLength(2);
    expect(site.activeJobs().filter(job=>job.status==='queued')).toHaveLength(4);
    runner.stop();site.recoverJobs();expect(site.job(jobs[5].id).status).toBe('queued');
    runner=new JobRunner(site,options);runner.pump();
    const results=await Promise.all(jobs.map(job=>runner.wait(job.id,15000)));
    expect(results.every(result=>result.active<=2)).toBe(true);expect(site.activeJobs()).toHaveLength(0);
  }finally{runner.stop();site.close();}
},20000);
it('ARC-17 enforces operation body budgets for both declared and streamed content lengths',async()=>{
  await expect(readJsonBody(new Request('http://localhost',{method:'POST',headers:{'Content-Length':'1000'},body:'{}'}),10)).rejects.toMatchObject({status:413});
  await expect(readJsonBody(new Request('http://localhost',{method:'POST',body:JSON.stringify({value:'x'.repeat(100)})}),64)).rejects.toMatchObject({status:413});
  expect(await readJsonBody(new Request('http://localhost',{method:'POST',body:'{"value":"中文😀"}'}),64)).toEqual({value:'中文😀'});
});
it('ARC-07 updates visitor counts incrementally, including duplicate, update and delete events',()=>{
  const root=join(base,'counts'),site=new Site(root);site.close();const analytics=new Analytics(root);
  try{
    const insert=analytics.raw.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for(let index=0;index<3;index++)insert.run('id-'+index,'view',new Date().toISOString(),'/one/','','','','','','','');
    analytics.raw.prepare("UPDATE events SET path='/two/' WHERE id='id-0'").run();
    analytics.raw.prepare("DELETE FROM events WHERE id='id-1'").run();
    const queries:string[]=[],prepare=analytics.raw.prepare.bind(analytics.raw);
    analytics.raw.prepare=((sql:string)=>{queries.push(sql);return prepare(sql);}) as typeof analytics.raw.prepare;
    expect([...analytics.viewTotals([{id:'one',path:'/one/'},{id:'two',path:'/two/'}])]).toEqual([['one',1],['two',1]]);
    expect(queries.every(sql=>!sql.includes('FROM events'))).toBe(true);
  }finally{analytics.close();}
});
it('ARC-17 caps noisy worker output and keeps task results readable',async()=>{
  const site=new Site(join(base,'log-cap')),worker=join(base,'noisy-worker.mjs');
  writeFileSync(worker,`process.stdout.write('x'.repeat(200000));await new Promise(resolve=>setTimeout(resolve,100));`);
  const runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),worker,logBytes:1024});
  try{
    const job=runner.enqueue('noisy',{});await expect(runner.wait(job.id,10000)).rejects.toThrow('意外退出');
    const {readJobLog}=await import('@weava/core');const log=await readJobLog(join(site.root,'logs',job.id+'.log'),0);
    expect(log.total).toBeLessThan(1600);expect(log.text).toContain('日志已达到上限');expect(site.job(job.id).status).toBe('failed');
  }finally{runner.stop();site.close();}
});
