import {describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {get,type IncomingMessage,type ClientRequest} from 'node:http';
import {createServer} from 'node:net';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {Site} from '../packages/core/src/site.ts';
const entry=process.env.WEAVA_TEST_WEB_ENTRY;
if(process.env.WEAVA_REQUIRE_HTTP_TESTS==='1'&&!entry)throw new Error('必须提供本次版本的编译 HTTP 入口，不能跳过生命周期测试。');
const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/audit-remediation-20261106';
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port as number;}
function control(child:ChildProcess,action:string,timeoutMs=1500){return new Promise<any>((resolve,reject)=>{
 const id=randomUUID(),timer=setTimeout(()=>{child.off('message',receive);reject(new Error('control timed out: '+action));},timeoutMs+3000);
 const receive=(message:any)=>{if(message?.controlId!==id)return;clearTimeout(timer);child.off('message',receive);resolve(message);};child.on('message',receive);child.send({type:'weava-control',controlId:id,action,timeoutMs});
});}
interface RunningSite{root:string;origin:string;headers:Record<string,string>;child:ChildProcess}
interface Options{media?:boolean;validation?:boolean;slow?:boolean;starting?:(value:RunningSite)=>Promise<void>}
async function fixture(run:(value:RunningSite)=>Promise<void>,options:Options={}){
 const root=join(base,'http-'+randomUUID()),site=new Site(root),listen=await port(),origin='http://127.0.0.1:'+listen;
 if(options.slow){const job=site.createJob('startup-fixture',{});site.updateJob(job.id,{managed:true});writeFileSync(join(root,'extensions/index.mjs'),'export default async()=>{await new Promise(r=>setTimeout(r,1800));return {id:"slow",apiVersion:1};}');}
 site.close();writeFileSync(join(root,'site.json'),JSON.stringify({version:2,id:'http-check',port:listen,features:['media'],template:'blank'}));
 if(options.media!==false){mkdirSync(join(root,'media'),{recursive:true});writeFileSync(join(root,'media/stream.mp4'),Buffer.alloc(16*1024*1024,7));}
 const headers={Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8')};
 const child=spawn(process.execPath,[entry!],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:process.cwd(),WEAVA_SOURCE_WORKER:'1',WEAVA_DATABASE_MODE:'open',WEAVA_VALIDATION:options.validation?'1':'0',HOST:'127.0.0.1',PORT:String(listen),WEAVA_REQUIRE_HTTPS:'0',NODE_ENV:'production'}});
 let errors='';child.stdout!.on('data',b=>errors=(errors+b).slice(-12000));child.stderr!.on('data',b=>errors=(errors+b).slice(-12000));
 try{
  if(options.starting)await options.starting({root,origin,headers,child});
  let ready=false;for(let n=0;n<150;n++){if(child.exitCode!==null)throw new Error(errors);try{const r=await fetch(origin+'/__health',{headers,signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}expect(ready,errors).toBe(true);
  await run({root,origin,headers,child});
 }finally{
  if(child.connected)child.send({type:'weava-control',action:'shutdown'});
  if(child.exitCode===null){await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null){child.kill();await once(child,'exit');}}
 }
}
async function stalled(origin:string,headers:Record<string,string>){
 return new Promise<{response:IncomingMessage;request:ClientRequest;received:number}>((resolve,reject)=>{
  const request=get(origin+'/media/stream.mp4',{headers},response=>{
   response.once('data',chunk=>{response.pause();resolve({request,response,received:chunk.length});});response.once('error',()=>{});
  });request.once('error',reject);
 });
}
describe('compiled HTTP lifecycle',{skip:!entry},()=>{
 it('WVA-04 waits for initialization even when an early resume control message arrives',async()=>fixture(async({root})=>{
  const site=new Site(root);try{for(let n=0;n<100&&site.jobs()[0].status==='queued';n++)await new Promise(r=>setTimeout(r,50));expect(site.jobs()[0].status).not.toBe('queued');}finally{site.close();}
 },{media:false,validation:true,slow:true,starting:async({root,origin,headers,child})=>{
  let response:Response|undefined;for(let n=0;n<100;n++){try{response=await fetch(origin+'/api/admin/v1/settings',{headers,signal:AbortSignal.timeout(1000)});break;}catch{}await new Promise(r=>setTimeout(r,50));}
  expect(response?.status).toBe(503);await response?.body?.cancel();
  let answered=false;const resumed=control(child,'resume',5000).then(result=>{answered=true;return result;});
  await new Promise(r=>setTimeout(r,400));const site=new Site(root);try{expect(site.jobs()[0].status).toBe('queued');expect(answered).toBe(false);}finally{site.close();}
  expect((await resumed).error).toBeUndefined();
 }}),45000);
 it('ARC-R04 holds writes and queued jobs behind initialization, including validation-only startup',async()=>fixture(async({root,child})=>{
  const site=new Site(root);try{expect(site.jobs()[0].status).toBe('queued');expect((await control(child,'resume')).error).toBeUndefined();for(let n=0;n<100&&site.jobs()[0].status==='queued';n++)await new Promise(r=>setTimeout(r,50));expect(site.jobs()[0].status).not.toBe('queued');}finally{site.close();}
 },{media:false,validation:true,slow:true,starting:async({root,origin,headers})=>{
  let response:Response|undefined;for(let n=0;n<100;n++){try{response=await fetch(origin+'/api/admin/v1/settings',{headers,signal:AbortSignal.timeout(1000)});break;}catch{}await new Promise(r=>setTimeout(r,50));}
  expect(response?.status).toBe(503);expect(response?.headers.get('cache-control')).toBe('no-store');await response?.body?.cancel();
  await new Promise(r=>setTimeout(r,400));const site=new Site(root);try{expect(site.jobs()[0].status).toBe('queued');}finally{site.close();}
 }}),45000);
 it('WVA-02 waits for downloads, resumes after drain timeout, and releases cancelled responses',async()=>fixture(async({origin,headers,child})=>{
  const download=await stalled(origin,headers);
  try{
   const waiting=await control(child,'drain',250);expect(waiting.error).toMatch(/仍有任务|请求/);
   const health=await fetch(origin+'/__health',{headers});expect(health.status).toBe(200);await health.body?.cancel();
   let received=download.received;download.response.on('data',chunk=>received+=chunk.length);download.response.resume();await once(download.response,'end');expect(received).toBe(16*1024*1024);
  }finally{download.request.destroy();download.response.destroy();}
  const cancelled=await stalled(origin,headers);cancelled.request.destroy();cancelled.response.destroy();
  const drained=await control(child,'drain');expect(drained.error).toBeUndefined();expect(drained.value).toEqual({drained:true});
  expect((await control(child,'resume')).error).toBeUndefined();
 }),45000);
 it('WVA-06 rejects JSON import and plan writes over HTTP without changing content',async()=>fixture(async({root,origin,headers})=>{
  for(const [path,body] of [
   ['import',{value:{version:1,types:[{id:'post',label:'Post',pathPrefix:'/posts/',template:'article',fields:[]}],entries:[{id:'blocked',kind:'content',type:'post',title:'Must not be written',path:'/blocked/'}]}}],
   ['plans',{value:{id:'blocked',label:'Must not be written',items:[]},revision:null}],
  ] as const){const response=await fetch(origin+'/api/admin/v1/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});await response.body?.cancel();expect(response.status,path).toBe(404);}
  const site=new Site(root);try{expect(site.entries()).toHaveLength(0);expect(site.store.list('publication-plan')).toHaveLength(0);}finally{site.close();}
 },{media:false}),45000);
});
