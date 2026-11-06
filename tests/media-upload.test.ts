import { expect,it } from 'vitest';
import { join,resolve } from 'node:path';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { Site,JobRunner } from '@weava/core';
import { beginMediaUpload,mediaUploadStatus,receiveMediaChunk,finishMediaUpload } from '../packages/core/src/media-upload.ts';
import { createAdminClient } from '@weava/contracts/api-client';
import { readMediaUploadRequest } from '../packages/core/src/legacy-media-upload.ts';
const base='D:/Tools/cache/weava/tests/media-upload-'+Date.now();
const chunk=(value:string|Uint8Array)=>new Request('http://localhost/api/admin/v1/media/uploads/id',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:value as BodyInit});
it('resumes binary chunks across connections, recovers a partial write and deduplicates processing',async()=>{
  const site=new Site(join(base,'resume')),runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});
  try{
    const upload=beginMediaUpload(site,'notes.txt',10,'stable');expect(beginMediaUpload(site,'notes.txt',10,'stable').id).toBe(upload.id);
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
    const upload=beginMediaUpload(site,'bad.txt',70000),bytes=new Uint8Array(70000).fill(65);bytes[69999]=0;
    await expect(receiveMediaChunk(site,upload.id,0,chunk(new Uint8Array(70001)))).rejects.toMatchObject({status:413});
    expect(mediaUploadStatus(site,upload.id).offset).toBe(0);
    await receiveMediaChunk(site,upload.id,0,chunk(bytes));const job=finishMediaUpload(site,runner,upload.id);
    await expect(runner.wait(job.id,15000)).rejects.toThrow(/格式/);expect(site.store.list('media')).toEqual([]);
    const next=finishMediaUpload(site,runner,upload.id);expect(next.id).not.toBe(job.id);await expect(runner.wait(next.id,15000)).rejects.toThrow(/格式/);
  }finally{runner.stop();site.close();}
},20000);
it('sends raw binary through the shared typed client and documents its distinct wire format',async()=>{
  const body=new Uint8Array([1,2,3]),calls:RequestInit[]=[];
  const client=createAdminClient({fetch:async(_url,init)=>{calls.push(init!);return Response.json({id:'id',name:'file.txt',size:3,offset:3,status:'receiving',expiresAt:new Date().toISOString(),chunkBytes:1024*1024});}});
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
