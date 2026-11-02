import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { JobRunner, Site, readJsonBody, Analytics } from '@weava/core';
const base='D:/Tools/cache/weava/tests/job-runner-'+Date.now();
it('ARC-17 bounds all task processes, deduplicates submissions and resumes persisted queued tasks',async()=>{
  const site=new Site(join(base,'site')),worker=join(base,'worker.mjs');
  writeFileSync(worker,`import{createRequire}from'node:module';const require=createRequire(${JSON.stringify(resolve('package.json'))});const Database=require('better-sqlite3');const[root,id]=process.argv.slice(2);const db=new Database(root+'/weava.sqlite');db.pragma('busy_timeout=5000');const job=JSON.parse(db.prepare('SELECT data FROM jobs WHERE id=?').get(id).data);const active=db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='running'").get().n;await new Promise(resolve=>setTimeout(resolve,250));const result={...job,status:'complete',result:{active,pid:process.pid}};db.prepare('UPDATE jobs SET status=?,data=? WHERE id=?').run('complete',JSON.stringify(result),id);db.close();`);
  const options={framework:resolve('.'),worker,concurrency:2,maxQueued:8};
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
  const runner=new JobRunner(site,{framework:resolve('.'),worker,logBytes:1024});
  try{
    const job=runner.enqueue('noisy',{});await expect(runner.wait(job.id,10000)).rejects.toThrow('意外退出');
    const {readJobLog}=await import('@weava/core');const log=await readJobLog(join(site.root,'logs',job.id+'.log'),0);
    expect(log.total).toBeLessThan(1600);expect(log.text).toContain('日志已达到上限');expect(site.job(job.id).status).toBe('failed');
  }finally{runner.stop();site.close();}
});
