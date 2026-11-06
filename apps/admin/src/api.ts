import type { AdminClient } from '@weava/contracts/api-client';
import { ApiClientError } from '@weava/contracts/api-error';
import { adminQueries } from './query-cache.ts';
import {affectedQueries,mutationDomains,jobDomains} from './query-effects.ts';
import { sessionResult, loginBody, loginResult, logoutResult, apiErrorSchema,accountAccessBody,accountAccessResult,completeAccountAccessBody,completeAccountAccessResult } from '@weava/contracts/session-api';
export { ApiClientError as ApiError } from '@weava/contracts/api-error';
const unauthorized=()=>{
  adminQueries.suspend();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('weava-session-expired'));
};
const signedOut=()=>{adminQueries.suspend();if(typeof window!=='undefined')window.dispatchEvent(new Event('weava-session-ended'));};
let fullClient:Promise<AdminClient>|undefined;
const client=()=>fullClient??=import('@weava/contracts/api-client').then(module=>module.createAdminClient({onUnauthorized:unauthorized}));
async function transport(path:string,body?:unknown):Promise<any>{
  if(!['session','login','logout','account-access','account-access/complete'].includes(path))return (await client()).request(path,body);
  try{
    if(path==='session'&&body!==undefined||path!=='session'&&body===undefined)throw new Error('method');
    if(path==='login')body=loginBody.parse(body);
    if(path==='account-access')body=accountAccessBody.parse(body);
    if(path==='account-access/complete')body=completeAccountAccessBody.parse(body);
    if(path==='logout'&&(!body||typeof body!=='object'||Object.keys(body).length))throw new Error('body');
  }catch(error:any){throw new ApiClientError('请求参数无效。',400,error.issues);}
  let response:Response;
  try{response=await fetch('/api/admin/v1/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}
  catch(error:any){throw new ApiClientError(error.name==='TimeoutError'?'网站响应超时，请稍后重试。':'无法连接网站，请检查服务和网络后重试。',0);}
  let value:unknown;try{value=await response.json();}catch{throw new ApiClientError('网站没有返回有效结果，请稍后重试。',response.status);}
  if(!response.ok){if(response.status===401&&path==='logout')unauthorized();const parsed=apiErrorSchema.safeParse(value),retry=Number(response.headers.get('retry-after'));throw new ApiClientError(parsed.success?parsed.data.error:'操作没有完成，请重试。',response.status,parsed.success?parsed.data.details:undefined,retry>0?retry:undefined);}
  const parsed=(path==='session'?sessionResult:path==='login'?loginResult:path==='account-access'?accountAccessResult:path==='account-access/complete'?completeAccountAccessResult:logoutResult).safeParse(value);
  if(!parsed.success)throw new ApiClientError('网站返回的数据与接口定义不一致。',502,parsed.error.issues);
  return parsed.data;
}
async function perform(path:string,body:unknown,execute:()=>Promise<any>):Promise<any>{
  const mutation = body !== undefined;
  const authentication = ['login','logout','account-access/complete'].includes(path);
  if (path === 'logout') adminQueries.suspend();
  else if(authentication&&mutation)adminQueries.invalidate(true);
  const end=mutation&&!authentication?adminQueries.beginWrite(affectedQueries(mutationDomains(path,body))):()=>{};
  try {
    const value = await execute();
    if (path === 'login' || path === 'account-access/complete') adminQueries.resume();
    if(path==='logout')signedOut();
    return value;
  }
  catch(error){
    if(path==='logout'){
      // The response may have been lost after commit. Resolve the session, not a guess.
      try{const session=await transport('session');if(session.authenticated)adminQueries.resume();else signedOut();}
      catch{unauthorized();}
    }
    throw error;
  }
  finally { end(); }
}
async function request(path:string,body?:unknown):Promise<any>{return perform(path,body,()=>transport(path,body));}
export const api=Object.assign(request,{request,call:async(...args:Parameters<AdminClient['call']>)=>{
  const {adminApi}=await import('@weava/contracts/api');
  return perform(adminApi[args[0]].path,'body' in args[1]?args[1].body:undefined,async()=>(await client()).call(...args));
}}) as AdminClient;
export async function waitJob(job: any, onProgress: (job: any) => void) {
  while (['queued', 'running'].includes(job.status)) {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = await api(`job/${job.id}`);
  }
  onProgress(job);
  adminQueries.invalidate(false,affectedQueries(jobDomains(job.operation??'')));
  if (job.status !== 'complete') throw new ApiClientError(job.message,job.errorStatus??400,{jobId:job.id,cause:job.errorDetails});
  return job;
}
