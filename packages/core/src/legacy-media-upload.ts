import {mkdir,open,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Site} from './site.ts';
import type {JobRunner} from './job-runner.ts';
import {WeavaError} from '../../contracts/src/errors.ts';
import {inside} from '../../runtime-common/src/paths.ts';
import {beginMediaUpload} from './media-upload.ts';
import {registerStagedRequest,closeStagedRequest,temporaryPath} from './temporary-files.ts';

/** Old clients can keep JSON/base64; large JSON never enters the web process heap. */
export async function readMediaUploadRequest(site:Site,jobs:Pick<JobRunner,'query'>,request:Request){
  const limit=45*1024*1024,small=64*1024;
  if(Number(request.headers.get('content-length'))>limit)throw new WeavaError('请求内容超过大小限制。',413);
  if(!request.body)throw new WeavaError('请求内容不是有效 JSON。');
  const reader=request.body.getReader();let total=0,parts:Uint8Array[]=[],file:Awaited<ReturnType<typeof open>>|undefined,path='',stagedId='';
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>limit){await reader.cancel();throw new WeavaError('请求内容超过大小限制。',413);}
      if(!file&&total>small){await mkdir(join(site.root,'uploads'),{recursive:true});path='uploads/'+randomUUID()+'.legacy';stagedId=registerStagedRequest(site,path,'legacy-media',limit);file=await open(temporaryPath(site,path),'wx');for(const part of parts)await file.writeFile(part);parts=[];}
      if(file)await file.writeFile(value);else parts.push(value);
    }
    if(file){await file.close();file=undefined;return {uploadId:await jobs.query('legacy-media-stage',{path}) as string};}
    let data:any;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new WeavaError('请求内容不是有效 JSON。');}
    if(typeof data?.name==='string'&&typeof data.base64==='string')return {uploadId:await stageDecodedUpload(site,data.name,Buffer.from(data.base64,'base64'))};
    return data;
  }finally{reader.releaseLock();await file?.close();if(stagedId){closeStagedRequest(site,stagedId,total);site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(stagedId);}}
}
/** The bounded worker pool owns legacy decoding; the regular media worker reads a file. */
export async function decodeLegacyMediaUpload(site:Site,path:string){
  const source=temporaryPath(site,path);
  let data:any;try{data=JSON.parse(await readFile(source,'utf8'));}catch{throw new WeavaError('请求内容不是有效 JSON。');}
  if(typeof data?.name!=='string'||typeof data.base64!=='string')throw new WeavaError('请求参数无效。');
  const name=data.name,bytes=Buffer.from(data.base64,'base64');data=undefined;
  return stageDecodedUpload(site,name,bytes,source);
}
async function stageDecodedUpload(site:Site,name:string,bytes:Buffer,source?:string){
  const upload=beginMediaUpload(site,name,bytes.length,undefined,createHash('sha256').update(bytes).digest('hex')),destination=inside(site.root,'uploads/'+upload.id+'.bin');
  await mkdir(join(site.root,'uploads'),{recursive:true});await writeFile(source??destination,bytes);
  if(source){await rename(source,destination);site.store.raw.prepare('DELETE FROM staged_requests WHERE path=?').run('uploads/'+source.split(/[\\/]/).at(-1));}
  site.store.raw.prepare('UPDATE media_uploads SET offset=size WHERE id=?').run(upload.id);
  return upload.id;
}
