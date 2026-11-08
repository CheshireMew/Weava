import {readFileSync} from 'node:fs';
import type {Site} from './site.ts';
import type {JobRunner} from './job-runner.ts';
import {WeavaError} from '@weava/contracts';
import {importRequestSchema} from '../../contracts/src/api-models.ts';
import {importRequestBytes} from '../../contracts/src/import-limits.ts';
import {spoolRequest,temporaryPath,type StagedRequest} from './temporary-files.ts';
import {digestFile} from './file-io.ts';
import {importSite} from './exchange.ts';

export async function queueJsonImport(site:Site,jobs:JobRunner,request:Request){
  const staged=await spoolRequest(site,request,'import-json',importRequestBytes);
  const key=request.headers.get('Idempotency-Key')??undefined;
  try{return site.store.raw.transaction(()=>{
    if(key){const found=site.store.raw.prepare('SELECT data FROM jobs WHERE idempotency=?').get(key) as {data:string}|undefined;
      if(found){const job=JSON.parse(found.data);site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(staged.id);
        if(job.operation!=='import-json'||job.payload.sha256!==staged.sha256)throw new WeavaError('相同请求标识不能用于不同导入文件。',409);return job;
      }
    }
    const job=jobs.enqueue('import-json',{requestId:staged.id,sha256:staged.sha256},key);
    site.store.raw.prepare('UPDATE staged_requests SET job_id=? WHERE id=?').run(job.id,staged.id);return job;
  }).immediate();}catch(error){site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(staged.id);throw error;}
}
export function executeJsonImport(site:Site,jobId:string,payload:{requestId:string;sha256:string}){
  const staged=site.store.raw.prepare("SELECT * FROM staged_requests WHERE id=? AND kind='import-json' AND job_id=?").get(payload.requestId,jobId) as StagedRequest|undefined;
  if(!staged)throw new WeavaError('导入暂存文件不存在。',404);
  const path=temporaryPath(site,staged.path);if(digestFile(path)!==payload.sha256)throw new WeavaError('导入文件校验失败。',409);
  let data:unknown;try{data=JSON.parse(readFileSync(path,'utf8'));}catch{throw new WeavaError('导入文件不是有效 JSON。');}
  const parsed=importRequestSchema.safeParse(data);if(!parsed.success)throw new WeavaError('导入文件格式不正确。',400,parsed.error.issues);
  return site.store.raw.transaction(()=>{
    site.store.assertTask();const result=importSite(site,parsed.data.value,parsed.data.options);
    site.updateJob(jobId,{status:'complete',message:'导入处理已完成。',result});return result;
  }).immediate();
}
