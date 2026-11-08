import {afterEach,expect,it} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Site,JobRunner} from '@weava/core';
import {queueJsonImport} from '../packages/core/src/json-import.ts';
import {importRequestBytes} from '../packages/contracts/src/import-limits.ts';
import {beginMediaUpload,receiveMediaChunk,finishMediaUpload,completeMediaUpload,mediaUploadStatus} from '../packages/core/src/media-upload.ts';
import {previewTemporaryCleanup,cleanupTemporaryFiles,cancelUpload,spoolRequest,registerStagedRequest,closeStagedRequest} from '../packages/core/src/temporary-files.ts';
import {storageUsage} from '../packages/core/src/maintenance.ts';

const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','temporary-lifecycle-'+Date.now()),sites:Site[]=[];
const fixture=()=>{const site=new Site(join(base,randomUUID()));sites.push(site);return site;};
const sha=(body:string)=>createHash('sha256').update(body).digest('hex');
const chunk=(body:string)=>new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
afterEach(()=>sites.splice(0).forEach(site=>site.close()));

it('streams more than 16 MiB into a durable JSON import job, previews then commits atomically',async()=>{
  const site=fixture(),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});
  const value={version:1,entries:[{id:'streamed',kind:'page',title:'Imported',path:'/streamed/',document:{version:1,format:'markdown',source:'Imported body'}}]};
  const request=(dryRun:boolean)=>{let count=0;return new Request('http://localhost',{method:'POST',duplex:'half',body:new ReadableStream({pull(controller){
    if(count++===0)controller.enqueue(new TextEncoder().encode(JSON.stringify({value,options:{dryRun}})));
    else if(count<=18)controller.enqueue(new Uint8Array(1024*1024).fill(32));else controller.close();
  }})} as any);};
  try{
    const preview=await queueJsonImport(site,runner,request(true));expect(preview.status).toBe('queued');expect(site.store.get('entry','streamed')).toBeNull();
    runner.pause(false);expect(await runner.wait(preview.id,20000)).toMatchObject({dryRun:true,imported:1});expect(site.store.get('entry','streamed')).toBeNull();
    const saved=await queueJsonImport(site,runner,request(false));expect(await runner.wait(saved.id,20000)).toMatchObject({dryRun:false,created:['entry:streamed']});
    expect(site.store.get('entry','streamed')?.value.title).toBe('Imported');
    const plan=previewTemporaryCleanup(site);expect(plan.files).toHaveLength(2);expect(plan.bytes).toBeGreaterThan(32*1024*1024);
    expect(cleanupTemporaryFiles(site,plan.review).files).toBe(2);
  }finally{runner.stop();}
},50000);

it('deduplicates repeated JSON requests and records malformed or over-budget inputs for recovery',async()=>{
  const site=fixture(),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});
  const request=(body:string)=>new Request('http://localhost',{method:'POST',headers:{'Idempotency-Key':'same-import'},body});
  try{
    const first=await queueJsonImport(site,runner,request('{"value":{"version":1}}'));
    expect((await queueJsonImport(site,runner,request('{"value":{"version":1}}'))).id).toBe(first.id);
    await expect(queueJsonImport(site,runner,request('{"value":{"version":2}}'))).rejects.toMatchObject({status:409});
    await expect(queueJsonImport(site,runner,new Request('http://localhost',{method:'POST',headers:{'Content-Length':String(importRequestBytes+1)},body:'{}'}))).rejects.toMatchObject({status:413});
    const malformed=await queueJsonImport(site,runner,new Request('http://localhost',{method:'POST',body:'{broken'}));
    runner.pause(false);await runner.wait(first.id,15000);await expect(runner.wait(malformed.id,15000)).rejects.toThrow(/JSON/);
    expect(site.job(malformed.id).status).toBe('failed');
    await expect(spoolRequest(site,chunk('12345'),'test',4)).rejects.toMatchObject({status:413});
    expect(previewTemporaryCleanup(site).files.length).toBeGreaterThanOrEqual(3);
  }finally{runner.stop();}
},35000);

it('rejects same-name and same-size content changes before media processing',async()=>{
  const site=fixture(),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});
  try{
    const upload=beginMediaUpload(site,'same.txt',4,'same-name',sha('AAAA'));
    expect(()=>beginMediaUpload(site,'same.txt',4,'same-name',sha('BBBB'))).toThrow(/不同文件/);
    await receiveMediaChunk(site,upload.id,0,chunk('BBBB'));const job=finishMediaUpload(site,runner,upload.id);
    await expect(completeMediaUpload(site,upload.id,job.id)).rejects.toThrow(/校验失败/);expect(site.store.list('media')).toHaveLength(0);
    expect(readFileSync(join(site.root,'uploads',upload.id+'.bin'),'utf8')).toBe('BBBB');
  }finally{runner.stop();}
});

it('cleans only reviewed ended uploads, rejects changed previews, and preserves active files and unregistered files',async()=>{
  const site=fixture(),ended=beginMediaUpload(site,'ended.txt',4,undefined,sha('done')),live=beginMediaUpload(site,'live.txt',4,undefined,sha('live'));
  await receiveMediaChunk(site,ended.id,0,chunk('done'));await receiveMediaChunk(site,live.id,0,chunk('live'));cancelUpload(site,ended.id);
  const unknown=join(site.root,'uploads','user-file.txt');writeFileSync(unknown,'keep');
  const first=previewTemporaryCleanup(site);expect(first.files.map(file=>file.id)).toEqual([ended.id]);
  writeFileSync(join(site.root,'uploads',ended.id+'.bin'),'changed');expect(()=>cleanupTemporaryFiles(site,first.review)).toThrow(/已变化/);
  const next=previewTemporaryCleanup(site);expect(cleanupTemporaryFiles(site,next.review)).toEqual({files:1,bytes:7});
  expect(mediaUploadStatus(site,ended.id).status).toBe('purged');expect(existsSync(join(site.root,'uploads',live.id+'.bin'))).toBe(true);expect(readFileSync(unknown,'utf8')).toBe('keep');
  site.store.raw.prepare('UPDATE media_uploads SET expires=0,lease_until=? WHERE id=?').run(Date.now()+60000,live.id);
  expect(previewTemporaryCleanup(site).files).toEqual([]);expect(()=>cancelUpload(site,live.id)).toThrow(/分块/);
  site.store.raw.prepare('UPDATE media_uploads SET lease_until=0 WHERE id=?').run(live.id);
  expect(previewTemporaryCleanup(site).files.map(file=>file.id)).toEqual([live.id]);expect(storageUsage(site).uploadsBytes).toBe(8);
});

it('never follows linked temporary directories during preview, cleanup or capacity reporting',()=>{
  const site=fixture(),upload=beginMediaUpload(site,'linked.txt',4,undefined,sha('keep')),outside=join(base,'linked-target-'+randomUUID());
  mkdirSync(outside);const file=join(outside,upload.id+'.bin');writeFileSync(file,'keep');symlinkSync(outside,join(site.root,'uploads'),'junction');cancelUpload(site,upload.id);
  const plan=previewTemporaryCleanup(site);expect(plan.files).toEqual([]);expect(plan.skipped).toHaveLength(1);expect(storageUsage(site).uploadsBytes).toBe(0);
  expect(cleanupTemporaryFiles(site,plan.review).files).toBe(0);expect(readFileSync(file,'utf8')).toBe('keep');
});

it('protects request leases and active jobs and bounds reserved staging capacity',()=>{
  const site=fixture(),path='imports/request-'+randomUUID()+'.json',id=registerStagedRequest(site,path,'test',256*1024*1024);
  mkdirSync(join(site.root,'imports'),{recursive:true});writeFileSync(join(site.root,path),'{}');site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(id);
  expect(previewTemporaryCleanup(site).files).toEqual([]);
  expect(()=>registerStagedRequest(site,'imports/request-'+randomUUID()+'.json','test',300*1024*1024)).toThrow(/容量上限/);
  const job=site.createJob('test');closeStagedRequest(site,id,2);site.store.raw.prepare('UPDATE staged_requests SET job_id=? WHERE id=?').run(job.id,id);
  expect(previewTemporaryCleanup(site).files).toEqual([]);site.updateJob(job.id,{status:'cancelled'});
  const plan=previewTemporaryCleanup(site);expect(plan.files.map(file=>file.id)).toEqual([id]);expect(cleanupTemporaryFiles(site,plan.review).bytes).toBe(2);
});
