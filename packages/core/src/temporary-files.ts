import {mkdir,open} from 'node:fs/promises';
import {lstatSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Site} from './site.ts';
import {WeavaError} from '@weava/contracts';
import {digest} from '../../runtime-common/src/identity.ts';
import {inside,pathWithin} from '../../runtime-common/src/paths.ts';

export interface StagedRequest {id:string;path:string;kind:string;bytes:number;expires:number;active_until:number;job_id:string|null}
export function temporaryPath(site:Site,path:string){
  if(!/^(uploads|imports)\/(?:request-[a-f0-9-]+\.json|[a-f0-9-]+\.bin|[a-f0-9-]+\.legacy)$/.test(path))throw new WeavaError('暂存文件不属于可清理范围。',409);
  const result=inside(site.root,path),folder=join(site.root,path.split('/')[0]);
  for(const target of [site.root,folder,result])if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw new WeavaError('暂存路径包含目录关联，未操作文件。',409);
  if(!pathWithin(site.root,result))throw new WeavaError('暂存文件超出网站目录。',409);
  return result;
}
export function registerStagedRequest(site:Site,path:string,kind:string,maximum:number){
  temporaryPath(site,path);
  return site.store.raw.transaction(()=>{
    const total=site.store.raw.prepare('SELECT COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM staged_requests').get() as {count:number;bytes:number};
    if(total.count>=32||total.bytes+maximum>512*1024*1024)throw new WeavaError('暂存请求已达到容量上限，请在维护页面清理已结束的任务文件。',429);
    const id=randomUUID();site.store.raw.prepare('INSERT INTO staged_requests VALUES(?,?,?,?,?,?,NULL)').run(id,path,kind,maximum,Date.now()+86400000,Date.now()+120000);
    return id;
  }).immediate();
}
export function closeStagedRequest(site:Site,id:string,bytes:number){site.store.raw.prepare('UPDATE staged_requests SET bytes=?,active_until=0 WHERE id=?').run(bytes,id);}
export async function spoolRequest(site:Site,request:Request,kind:string,maximum:number){
  if(!request.body||Number(request.headers.get('content-length'))>maximum)throw new WeavaError('请求内容超过大小限制或为空。',413);
  const path='uploads/request-'+randomUUID()+'.json',id=registerStagedRequest(site,path,kind,maximum);
  let bytes=0,file:Awaited<ReturnType<typeof open>>|undefined,finished=false;
  const reader=request.body.getReader(),hash=createHash('sha256');let renewed=Date.now();
  try{
    await mkdir(join(site.root,'uploads'),{recursive:true});file=await open(temporaryPath(site,path),'wx');
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum){await reader.cancel();throw new WeavaError('请求内容超过大小限制。',413);}
      if(Date.now()-renewed>30000){renewed=Date.now();site.store.raw.prepare('UPDATE staged_requests SET active_until=? WHERE id=?').run(renewed+120000,id);}
      hash.update(part.value);await file.writeFile(part.value);
    }
    await file.sync();finished=true;return {id,path,sha256:hash.digest('hex')};
  }finally{reader.releaseLock();await file?.close();closeStagedRequest(site,id,bytes);if(!finished)site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(id);}
}
export function expireUploads(site:Site,clock=Date.now()){
  if(!site.store.raw.prepare("SELECT 1 FROM media_uploads WHERE status='receiving' AND expires<? AND lease_until<=? LIMIT 1").get(clock,clock))return;
  site.store.raw.prepare("UPDATE media_uploads SET status='expired' WHERE status='receiving' AND expires<? AND lease_until<=?").run(clock,clock);
}
export function cancelUpload(site:Site,id:string){
  return site.store.raw.transaction(()=>{
    const row=site.store.raw.prepare('SELECT * FROM media_uploads WHERE id=?').get(id) as any;if(!row)throw new WeavaError('上传不存在。',404);
    if(row.status==='complete'||row.status==='purged')return {id,status:row.status};
    if(row.lease_until>Date.now())throw new WeavaError('分块正在接收，请等待传送停止后再取消。',409);
    const job=row.job_id?site.job(row.job_id):null;if(job&&['queued','running'].includes(job.status))throw new WeavaError('文件正在处理，请先在任务记录中取消任务。',409);
    site.store.raw.prepare("UPDATE media_uploads SET status='cancelled',expires=0 WHERE id=?").run(id);return {id,status:'cancelled'};
  }).immediate();
}
interface Candidate {id:string;kind:'upload'|'request';path:string;bytes:number;stamp:string}
function inventory(site:Site){
  expireUploads(site);const clock=Date.now(),files:Candidate[]=[],skipped:{path:string;reason:string}[]=[];
  const add=(id:string,kind:Candidate['kind'],path:string)=>{
    try{const target=temporaryPath(site,path),stat=existsSync(target)?lstatSync(target):null;if(stat&&!stat.isFile())throw new Error('不是普通文件。');files.push({id,kind,path,bytes:stat?.size??0,stamp:stat?`${stat.ino}:${stat.size}:${stat.mtimeMs}`:'missing'});}
    catch(error:any){skipped.push({path,reason:error.message});}
  };
  for(const row of site.store.raw.prepare("SELECT u.* FROM media_uploads u LEFT JOIN jobs j ON j.id=u.job_id WHERE u.status<>'complete' AND u.status<>'purged' AND u.lease_until<=? AND COALESCE(j.status,'') NOT IN ('queued','running') AND (u.status IN ('expired','cancelled','purging') OR j.status IN ('failed','cancelled','recovery_required')) ORDER BY u.id LIMIT 100").all(clock) as any[])add(row.id,'upload','uploads/'+row.id+'.bin');
  for(const row of site.store.raw.prepare("SELECT r.* FROM staged_requests r LEFT JOIN jobs j ON j.id=r.job_id WHERE r.active_until<=? AND COALESCE(j.status,'') NOT IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM jobs active WHERE active.status IN ('queued','running') AND json_extract(active.data,'$.payload.sourceId')=r.id) AND (r.expires<=? OR r.kind<>'import-source' AND j.status IN ('complete','failed','cancelled','recovery_required')) ORDER BY r.id LIMIT 100").all(clock,clock) as StagedRequest[])add(row.id,'request',row.path);
  return {files,skipped};
}
export function previewTemporaryCleanup(site:Site){const {files,skipped}=inventory(site);return {files:files.map(({stamp,...row})=>row),skipped,bytes:files.reduce((sum,row)=>sum+row.bytes,0),review:digest(files)};}
export function cleanupTemporaryFiles(site:Site,review:string){
  return site.store.raw.transaction(()=>{
    const {files}=inventory(site);if(digest(files)!==review)throw new WeavaError('暂存文件或任务状态已变化，请重新检查。',409);
    // The short write transaction excludes chunk claims and new processing jobs.
    for(const row of files){const path=temporaryPath(site,row.path);if(existsSync(path))unlinkSync(path);
      if(row.kind==='upload')site.store.raw.prepare("UPDATE media_uploads SET status='purged',offset=0,lease=NULL,lease_until=0 WHERE id=?").run(row.id);
      else { site.store.raw.prepare('DELETE FROM staged_requests WHERE id=?').run(row.id);site.store.raw.prepare('DELETE FROM state WHERE key=?').run('import-source:'+row.id); }
    }
    return {files:files.length,bytes:files.reduce((sum,row)=>sum+row.bytes,0)};
  }).immediate();
}
