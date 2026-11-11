import {expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {Site,JobRunner} from '@weava/core';
import {entrySchema} from '@weava/contracts';
import {adminApi} from '@weava/contracts/api';
import {createAdminDispatcher} from '../apps/web/src/api/dispatch.ts';
import {registerReportsCommands} from '../packages/cli/src/commands/reports.ts';
import {Command} from 'commander';
import {createServer} from 'node:http';

it('enqueues SEO work without reading a release in the request process, deduplicates and returns compatible reports',async()=>{
  const site=new Site(join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','seo-jobs-'+Date.now()));
  const jobs=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
  try{
    site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'One',path:'/one/',status:'published',document:{version:1,format:'markdown',source:'Test body'}}),null);site.publish();
    const mainSite=new Proxy(site,{get(target,key,receiver){if(key==='release')throw new Error('Release read on HTTP process');return Reflect.get(target,key,receiver);}});
    const dispatch=createAdminDispatcher({site:mainSite,jobs} as any);
    const url=new URL('http://localhost/api/admin/v1/seo/audit'),request=new Request(url,{headers:{'Idempotency-Key':'seo-test'}}),context={url,request} as any;
    const response=await dispatch('seoAudit',{}, {target:'published'},context);
    expect(response.status).toBe(202);const job=await response.json();
    expect((await (await dispatch('seoAudit',{}, {target:'published'},context)).json()).id).toBe(job.id);
    const report=await jobs.wait(job.id,20000);
    expect(report).toMatchObject({rulesVersion:3,target:'published',coverage:{checked:1},stale:false});
    expect(adminApi.seoAudits.response.parse([report])).toHaveLength(1);
    const reports=await dispatch('seoAudits',{},undefined,{url:new URL('http://localhost/api/admin/v1/seo/audits'),request} as any);
    expect((await reports.json())[0]).toMatchObject({id:report.id});
    const processes=jobs.queryProcessCount;
    await dispatch('seoAudits',{},undefined,{url:new URL('http://localhost/api/admin/v1/seo/audits'),request} as any);
    expect(processes).toBeGreaterThan(0);expect(jobs.queryProcessCount).toBe(processes);
    await expect(dispatch('seoAudit',{}, {target:'draft',http:true},context)).rejects.toThrow(/已发布/);
  }finally{jobs.stop();site.close();}
},30000);

it.each(['complete','failed'])('keeps CLI SEO output after waiting for a %s task',async status=>{
  const program=new Command(),report={id:'report',coverage:{checked:1}},job={id:'job',status:'queued'},finished={...job,status,result:status==='complete'?report:undefined};
  const request=vi.fn(async()=>job),wait=vi.fn(async()=>finished),output=vi.fn();
  registerReportsCommands({program,request,wait,output} as any);
  await program.parseAsync(['seo','audit','--draft'],{from:'user'});
  expect(request).toHaveBeenCalledWith('seo/audit',{target:'draft',http:false,maxPages:200});
  expect(wait).toHaveBeenCalledWith(job,true);expect(output).toHaveBeenCalledWith(status==='complete'?report:finished);
});

it('runs resumable HTTP audits through the real reusable job service and rejects a changed publication',async()=>{
  const site=new Site(join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','seo-resume-'+Date.now()));
  const server=createServer((request,response)=>{
    response.setHeader('Content-Type',request.url==='/robots.txt'?'text/plain':request.url==='/sitemap.xml'?'application/xml':'text/html');
    response.end(request.url==='/robots.txt'?'User-agent: *\nAllow: /':request.url==='/sitemap.xml'?'<urlset/>':`<html><title>Page</title><main><h1>Page</h1><a href="/one/">One</a><a href="/two/">Two</a></main></html>`);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+(server.address() as any).port;
  const jobs=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
  try{
    for(const id of ['one','two'])site.saveEntry(entrySchema.parse({id,kind:'page',title:id,path:`/${id}/`,status:'published'}),null);
    const settings=site.settings();site.saveSettings({...settings.value,domain:origin},settings.revision);site.publish();
    const first=await jobs.wait(jobs.enqueue('seo-audit',{http:true,target:'published',origin,maxPages:2}).id,20000) as any;
    expect(first.crawl.complete).toBe(false);expect(first.coverage.checked).toBe(0);
    const second=await jobs.wait(jobs.enqueue('seo-audit',{http:true,target:'published',origin,maxPages:2,resume:first.id}).id,20000) as any;
    expect(second.crawl.complete).toBe(true);expect(second.coverage.checked).toBe(2);
    site.publish({scope:'settings'});
    await expect(jobs.wait(jobs.enqueue('seo-audit',{http:true,target:'published',origin,resume:first.id}).id,20000)).rejects.toThrow('已过期');
  }finally{jobs.stop();site.close();await new Promise<void>(done=>server.close(()=>done()));}
},30000);
