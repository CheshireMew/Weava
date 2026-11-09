import { expect,it,vi } from 'vitest';
import { join,resolve } from 'node:path';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { Site,JobRunner,saveMediaMetadata,saveMediaGroup,imageAttributes,responsiveImages } from '@weava/core';
import { beginMediaUpload,mediaUploadStatus,receiveMediaChunk,finishMediaUpload,completeMediaUpload,receiveMediaFile } from '../packages/core/src/media-upload.ts';
import { queueMediaOptimization } from '../packages/core/src/media.ts';
import * as io from '../packages/core/src/file-io.ts';
import sharp from 'sharp';
import { createAdminClient } from '@weava/contracts/api-client';
import { readMediaUploadRequest } from '../packages/core/src/legacy-media-upload.ts';
import {createHash} from 'node:crypto';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const base=(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/media-upload-'+Date.now();
const chunk=(value:string|Uint8Array)=>new Request('http://localhost/api/admin/v1/media/uploads/id',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:value as BodyInit});
it('returns an insertable original and its group before background work, without re-reading its hash',async()=>{
  const site=new Site(join(base,'original-first')), runner=new JobRunner(site,{startPaused:true,framework:resolve('.'),source:true});
  const hash=vi.spyOn(io,'digestFile'), asyncHash=vi.spyOn(io,'digestFileAsync');
  try {
    saveMediaGroup(site,{id:'pictures',label:'图片'},null);
    const bytes=await sharp({create:{width:1800,height:900,channels:3,background:'#337755'}}).png().toBuffer();
    const first=await receiveMediaFile(site,chunk(bytes),{name:'original.png',groupId:'pictures'});
    expect(first.value).toMatchObject({groupId:'pictures',width:1800,height:900,hash:sha(bytes),derivatives:[],optimization:{status:'pending'}});
    expect(readFileSync(site.root+first.value.url)).toEqual(bytes);
    expect(imageAttributes(site,first.value.url).src).toBe(first.value.url);
    const html=`<img src="${first.value.url}">`;expect(responsiveImages(site,html)).toContain(first.value.url);
    expect(hash).not.toHaveBeenCalled();expect(asyncHash).not.toHaveBeenCalled();
    const job=site.jobStore.jobs().find(job=>job.operation==='media-optimize')!;expect(job.status).toBe('queued');
    const edited=saveMediaMetadata(site,first.id,{name:'修改名称.png',alt:'正在编辑的说明'},first.revision);
    runner.pause(false);const optimized=await runner.wait(job.id,15000);
    expect(optimized.value.derivatives.map((item:any)=>item.width)).toEqual([480,960,1600]);
    expect(optimized.revision).toBe(edited.revision);expect(optimized.value.alt).toBe('正在编辑的说明');
    expect(responsiveImages(site,html)).toContain('srcset=');
    const after=saveMediaMetadata(site,first.id,{name:'继续编辑.png',alt:'优化后仍可编辑'},edited.revision);expect(after.value.derivatives.length).toBe(3);
    const duplicate=await receiveMediaFile(site,chunk(bytes),{name:'another.png'});
    expect(duplicate.id).toBe(first.id);expect(duplicate.revision).toBe(after.revision);expect(duplicate.value.name).toBe('继续编辑.png');
    const secondBytes=await sharp(bytes).resize(700).png().toBuffer();
    const [second,twin]=await Promise.all([receiveMediaFile(site,chunk(secondBytes),{name:'second.png'}),receiveMediaFile(site,chunk(secondBytes),{name:'same-content.png'})]);
    expect(twin.id).toBe(second.id);expect(site.store.list('media')).toHaveLength(2);
    const secondJob=site.jobStore.jobs().find(job=>job.operation==='media-optimize'&&job.payload.id===second.id)!;
    await runner.wait(secondJob.id,15000);expect(runner.queryProcessCount).toBe(1);
  } finally {hash.mockRestore();asyncHash.mockRestore();runner.stop();site.close();}
},35000);
it('keeps the original usable when optimization fails and permits retry',async()=>{
  const site=new Site(join(base,'optimization-retry')),runner=new JobRunner(site,{startPaused:true,framework:resolve('.'),source:true});
  try {
    const bytes=readFileSync(resolve('apps/web/public/default-covers/picsum-10.webp'));
    const row=await receiveMediaFile(site,chunk(bytes),{name:'retry.webp'}), job=site.jobStore.jobs()[0];
    const run=vi.spyOn((runner as any).background,'run').mockRejectedValueOnce(new Error('编码失败'));
    runner.pause(false);await expect(runner.wait(job.id,10000)).rejects.toThrow('编码失败');run.mockRestore();
    expect(site.store.get('media',row.id)?.value.optimization.status).toBe('failed');expect(readFileSync(site.root+row.value.url)).toEqual(bytes);
    const retried=queueMediaOptimization(site,row.id)!;expect(retried.id).not.toBe(job.id);await runner.wait(retried.id,15000);
    expect(site.store.get('media',row.id)?.value.optimization.status).toBe('complete');
  }finally{runner.stop();site.close();}
},30000);
it('validates streamed headers split across network reads and detects invalid text anywhere in the file',async()=>{
  const site=new Site(join(base,'stream-validation'));
  try {
    const bytes=readFileSync(resolve('apps/web/public/default-covers/picsum-10.webp'));
    let offset=0;const body=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(bytes.length,offset+3);controller.enqueue(bytes.subarray(offset,end));offset=end;}});
    const result=await receiveMediaFile(site,new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body,duplex:'half'} as any),{name:'split.webp'});
    expect(readFileSync(site.root+result.value.url)).toEqual(bytes);
    const invalid=Buffer.alloc(70000,65);invalid[69999]=0;
    await expect(receiveMediaFile(site,chunk(invalid),{name:'invalid.txt'})).rejects.toThrow('格式');expect(site.store.list('media')).toHaveLength(1);
  }finally{site.close();}
});
it('resumes interrupted background optimization and allows cancellation without blocking the original',async()=>{
  const site=new Site(join(base,'optimization-recovery')),runner=new JobRunner(site,{startPaused:true,framework:resolve('.'),source:true});
  try {
    const bytes=readFileSync(resolve('apps/web/public/default-covers/picsum-10.webp'));
    const row=await receiveMediaFile(site,chunk(bytes),{name:'recover.webp'}),job=site.jobStore.jobs()[0];
    site.updateJob(job.id,{status:'running',workerPid:99999999});site.recoverJobs();expect(site.job(job.id).status).toBe('queued');
    expect(runner.cancel(job.id).status).toBe('cancelled');expect(site.store.get('media',row.id)?.value.optimization.status).toBe('failed');
    expect(readFileSync(site.root+row.value.url)).toEqual(bytes);
    const retry=queueMediaOptimization(site,row.id)!;expect(retry.id).not.toBe(job.id);
  }finally{runner.stop();site.close();}
});
it('finishes WebP uploads on their first attempt and deduplicates repeated files without leftover staging files',async()=>{
  const site=new Site(join(base,'webp')),runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});
  try{
    for(const [index,name] of ['picsum-10.webp','picsum-11.webp','picsum-10.webp'].entries()){
      const saved=index===2?site.store.list('media').find(row=>row.value.name==='picsum-10.webp'):undefined;
      const renamed=saved?site.store.put('media',saved.id,{...saved.value,name:'自定义名称',alt:'已编辑的图片说明'},saved.revision):undefined;
      const bytes=readFileSync(resolve('apps/web/public/default-covers',name)),upload=beginMediaUpload(site,name,bytes.length,undefined,sha(bytes));
      await receiveMediaChunk(site,upload.id,0,chunk(bytes));
      const result=await runner.wait(finishMediaUpload(site,runner,upload.id).id,15000);
      expect(readFileSync(join(site.root,result.value.url.slice(1)))).toEqual(bytes);
      expect(mediaUploadStatus(site,upload.id).status).toBe('complete');
      expect(readdirSync(join(site.root,'uploads'))).toEqual([]);
      if(renamed){expect(result.revision).toBe(renamed.revision);expect(result.value.name).toBe('自定义名称');expect(result.value.alt).toBe('已编辑的图片说明');}
    }
    expect(site.store.list('media')).toHaveLength(2);
  }finally{runner.stop();site.close();}
},45000);
it('recovers the durable file after an interrupted database commit without publishing a failed upload',async()=>{
  const site=new Site(join(base,'commit-recovery')),runner=new JobRunner(site,{startPaused:true,framework:resolve('.'),source:true});
  try{
    const upload=beginMediaUpload(site,'recover.txt',7,undefined,sha('recover'));
    await receiveMediaChunk(site,upload.id,0,chunk('recover'));
    const job=finishMediaUpload(site,runner,upload.id);
    const put=vi.spyOn(site.store,'put').mockImplementationOnce(()=>{throw new Error('interrupted commit');});
    await expect(completeMediaUpload(site,upload.id,job.id)).rejects.toThrow('interrupted commit');
    put.mockRestore();
    expect(site.store.list('media')).toEqual([]);
    expect(mediaUploadStatus(site,upload.id).status).toBe('processing');
    const result=await completeMediaUpload(site,upload.id,job.id);
    expect(readFileSync(join(site.root,result.value.url.slice(1)),'utf8')).toBe('recover');
    expect(mediaUploadStatus(site,upload.id).status).toBe('complete');
    expect(site.store.list('media')).toHaveLength(1);
  }finally{runner.stop();site.close();}
});
it('resumes binary chunks across connections, recovers a partial write and deduplicates processing',async()=>{
  const site=new Site(join(base,'resume')),runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});
  try{
    const upload=beginMediaUpload(site,'notes.txt',10,'stable',sha('0123456789'));expect(beginMediaUpload(site,'notes.txt',10,'stable',sha('0123456789')).id).toBe(upload.id);
    await receiveMediaChunk(site,upload.id,0,chunk('0123'));
    expect(()=>finishMediaUpload(site,runner,upload.id)).toThrow(/完整上传/);
    await expect(receiveMediaChunk(site,upload.id,0,chunk('0123'))).rejects.toMatchObject({status:409});
    const reopened=new Site(site.root);try{expect(mediaUploadStatus(reopened,upload.id).offset).toBe(4);}finally{reopened.close();}
    let pulls=0;const body=new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(new TextEncoder().encode('45'));else controller.error(new Error('interrupted'));}});
    await expect(receiveMediaChunk(site,upload.id,4,new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body,duplex:'half'} as any))).rejects.toThrow('interrupted');
    expect(mediaUploadStatus(site,upload.id).offset).toBe(4);
    await receiveMediaChunk(site,upload.id,4,chunk('456789'));
    const job=finishMediaUpload(site,runner,upload.id);expect(finishMediaUpload(site,runner,upload.id).id).toBe(job.id);
    const result=await runner.wait(job.id,15000);expect(readFileSync(join(site.root,result.value.url.slice(1)),'utf8')).toBe('0123456789');
    expect(site.store.list('media')).toHaveLength(1);expect(readdirSync(join(site.root,'uploads'))).toEqual([]);expect(mediaUploadStatus(site,upload.id).status).toBe('complete');
  }finally{runner.stop();site.close();}
},20000);
it('validates the entire streamed text, rejects oversized chunks, and permits retry after a worker failure',async()=>{
  const site=new Site(join(base,'validation')),runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});
  try{
    const bytes=new Uint8Array(70000).fill(65);bytes[69999]=0;const upload=beginMediaUpload(site,'bad.txt',70000,undefined,sha(bytes));
    await expect(receiveMediaChunk(site,upload.id,0,chunk(new Uint8Array(70001)))).rejects.toMatchObject({status:413});
    expect(mediaUploadStatus(site,upload.id).offset).toBe(0);
    await receiveMediaChunk(site,upload.id,0,chunk(bytes));const job=finishMediaUpload(site,runner,upload.id);
    await expect(runner.wait(job.id,15000)).rejects.toThrow(/格式/);expect(site.store.list('media')).toEqual([]);
    const next=finishMediaUpload(site,runner,upload.id);expect(next.id).not.toBe(job.id);await expect(runner.wait(next.id,15000)).rejects.toThrow(/格式/);
  }finally{runner.stop();site.close();}
},20000);
it('sends raw binary through the shared typed client and documents its distinct wire format',async()=>{
  const body=new Uint8Array([1,2,3]),calls:RequestInit[]=[];
  const client=createAdminClient({fetch:async(_url,init)=>{calls.push(init!);return Response.json({id:'id',name:'file.txt',size:3,offset:3,status:'receiving',sha256:sha(body),expiresAt:new Date().toISOString(),chunkBytes:1024*1024});}});
  await client.request('media/uploads/id?offset=0',body);
  expect(new Headers(calls[0].headers).get('Content-Type')).toBe('application/octet-stream');expect(calls[0].body).toBe(body);
});
it('spools large legacy JSON and decodes it in the worker pool, while small legacy requests use async staging',async()=>{
  const site=new Site(join(base,'legacy')),runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});
  try{
    for(const size of [10,2*1024*1024]){
      const bytes=Buffer.alloc(size,65),payload=JSON.stringify({name:'资料.txt',base64:bytes.toString('base64')}),encoded=new TextEncoder().encode(payload);let offset=0,ticks=0;
      const body=new ReadableStream({pull(controller){if(offset===encoded.length){controller.close();return;}const end=Math.min(encoded.length,offset+16384);controller.enqueue(encoded.subarray(offset,end));offset=end;}});
      const timer=setInterval(()=>ticks++,5);let parsed:any;
      try{parsed=await readMediaUploadRequest(site,runner,new Request('http://localhost',{method:'POST',body,duplex:'half'} as any));}finally{clearInterval(timer);}
      expect(parsed).toEqual({uploadId:expect.any(String)});expect(mediaUploadStatus(site,parsed.uploadId).offset).toBe(size);
      if(size>65536)expect(ticks).toBeGreaterThan(0);
      const result=await runner.wait(finishMediaUpload(site,runner,parsed.uploadId).id,15000);expect(readFileSync(join(site.root,result.value.url.slice(1)))).toEqual(bytes);
    }
    expect(readdirSync(join(site.root,'uploads'))).toEqual([]);
    await expect(readMediaUploadRequest(site,runner,new Request('http://localhost',{method:'POST',body:'{broken'}))).rejects.toMatchObject({status:400});
  }finally{runner.stop();site.close();}
},30000);
