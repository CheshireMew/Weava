import {mkdir,open} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WeavaError} from '../../contracts/src/errors.ts';
import type {Site} from './site.ts';
import type {JobRunner} from './job-runner.ts';
import {inside} from '../../runtime-common/src/paths.ts';
interface Upload {id:string;name:string;size:number;offset:number;status:string;path:string;expires:number;lease:string|null;lease_until:number;job_id:string|null}
export const uploadChunkBytes=1024*1024;
const allowed=new Set(['.png','.jpg','.jpeg','.webp','.gif','.avif','.pdf','.txt','.csv','.vtt','.srt','.mp3','.mp4','.webm']);
const wire=(row:Upload)=>({id:row.id,name:row.name,size:row.size,offset:row.offset,status:row.status,expiresAt:new Date(row.expires).toISOString(),chunkBytes:uploadChunkBytes,...(row.job_id?{jobId:row.job_id}:{})});
function find(site:Site,id:string){const row=site.store.raw.prepare('SELECT * FROM media_uploads WHERE id=?').get(id) as Upload|undefined;if(!row)throw new WeavaError('上传不存在。',404);return row;}
export function beginMediaUpload(site:Site,name:string,size:number,key?:string){
  if(!Number.isSafeInteger(size)||size<1||size>32*1024*1024)throw new WeavaError('附件大小需要在 32 MB 以内。');
  if(!name||name.length>300||!allowed.has(extname(name).toLowerCase()))throw new WeavaError('不支持这个附件格式。');
  return site.store.raw.transaction(()=>{
    if(key){const old=site.store.raw.prepare('SELECT * FROM media_uploads WHERE idempotency=?').get(key) as Upload|undefined;if(old){if(old.name!==name||old.size!==size)throw new WeavaError('相同上传标识不能用于不同文件。',409);return wire(old);}}
    const id=randomUUID();site.store.raw.prepare("INSERT INTO media_uploads(id,name,size,offset,status,path,expires,idempotency) VALUES(?,?,?,0,'receiving',?,?,?)").run(id,name,size,'uploads/'+id+'.bin',Date.now()+24*3600000,key??null);
    return wire(find(site,id));
  }).immediate();
}
export function mediaUploadStatus(site:Site,id:string){return wire(find(site,id));}
/** A short lease protects concurrent chunks; the database write lock is never held across network I/O. */
export async function receiveMediaChunk(site:Site,id:string,offset:number,request:Request){
  if(!Number.isSafeInteger(offset)||offset<0)throw new WeavaError('上传位置无效。');
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/octet-stream')throw new WeavaError('上传分块需要二进制内容。',415);
  const lease=randomUUID(),row=site.store.raw.transaction(()=>{
    const row=find(site,id);
    if(row.status!=='receiving'||row.expires<Date.now())throw new WeavaError('上传已结束或过期，请重新上传。',409);
    if(row.offset!==offset)throw new WeavaError('上传位置已变化，请读取上传状态后继续。',409,{offset:row.offset});
    if(row.lease&&row.lease_until>Date.now())throw new WeavaError('另一份分块正在上传。',409);
    site.store.raw.prepare('UPDATE media_uploads SET lease=?,lease_until=? WHERE id=?').run(lease,Date.now()+120000,id);return row;
  }).immediate();
  let file:Awaited<ReturnType<typeof open>>|undefined,leaseUntil=Date.now()+120000;
  const maximum=Math.min(uploadChunkBytes,row.size-offset);let bytes=0;
  try{
    if(!request.body||maximum<1||Number(request.headers.get('content-length'))>maximum)throw new WeavaError('上传分块大小无效。',413);
    await mkdir(join(site.root,'uploads'),{recursive:true});
    const path=inside(site.root,row.path);file=await open(path,offset===0?'w':'r+');await file.truncate(offset);
    const reader=request.body.getReader();
    try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximum){await reader.cancel();throw new WeavaError('上传分块超过大小限制。',413);}
      if(Date.now()+60000>=leaseUntil){leaseUntil=Date.now()+120000;const renewed=site.store.raw.prepare('UPDATE media_uploads SET lease_until=? WHERE id=? AND lease=? AND offset=?').run(leaseUntil,id,lease,offset);if(!renewed.changes){await reader.cancel();throw new WeavaError('上传分块已由另一请求接管，请重新读取上传状态。',409);}}
      let written=0;while(written<value.length){const result=await file.write(value,written,value.length-written,offset+bytes-value.length+written);written+=result.bytesWritten;}
    }}finally{reader.releaseLock();}
    if(!bytes)throw new WeavaError('上传分块为空。');
    await file.sync();await file.close();file=undefined;
    const updated=site.store.raw.prepare('UPDATE media_uploads SET offset=offset+?,lease=NULL,lease_until=0,expires=? WHERE id=? AND lease=? AND offset=?').run(bytes,Date.now()+24*3600000,id,lease,offset);
    if(updated.changes!==1)throw new WeavaError('上传状态已变化，请重试。',409);
    return wire(find(site,id));
  }finally{await file?.close();site.store.raw.prepare('UPDATE media_uploads SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(id,lease);}
}
export function finishMediaUpload(site:Site,jobs:Pick<JobRunner,'enqueue'>,id:string){
  return site.store.raw.transaction(()=>{
    const row=find(site,id),old=row.job_id?site.job(row.job_id):undefined;if(old&&['queued','running','complete'].includes(old.status))return old;
    if(row.offset!==row.size||row.lease&&row.lease_until>Date.now()||row.expires<Date.now())throw new WeavaError('文件还没有完整上传，请继续上传。',409);
    const job=jobs.enqueue('media',{path:row.path,name:row.name,uploadId:id,size:row.size},'media-upload:'+id+(old?':'+old.id:''));
    site.store.raw.prepare("UPDATE media_uploads SET status='processing',job_id=? WHERE id=?").run(job.id,id);return job;
  }).immediate();
}
