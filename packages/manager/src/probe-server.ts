import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import type {Program} from './state.ts';

export async function freePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=(server.address() as any).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port as number;}
/** An isolated HTTP renderer, never the owner session and never a public port. */
export async function probeServer(node:string,program:Program,root:string,environment:Record<string,string>={},extra:Record<string,string>={}){
 const port=await freePort(),token=randomBytes(32).toString('hex'),origin='http://127.0.0.1:'+port;
 let errors='';const child=spawn(node,[join(program.root,'web/server/entry.mjs')],{cwd:program.root,windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,...environment,...extra,WEAVA_FRAMEWORK:program.root,WEAVA_PROGRAM_ROOT:program.root,WEAVA_ADMIN_DIST:join(program.root,'admin'),WEAVA_WORKER:join(program.root,'runtime/worker.mjs'),WEAVA_SOURCE_WORKER:'0',WEAVA_SITE:root,WEAVA_DATABASE_MODE:'open',WEAVA_VALIDATION:'1',WEAVA_UPGRADE_PROBE:token,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production'}});
 child.stderr!.on('data',data=>errors=(errors+data).slice(-8000));let launchError:Error|undefined;child.once('error',error=>launchError=error);
 async function stop(){
  if(child.exitCode!==null||child.signalCode!==null||launchError)return;
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('隔离检查进程未正常退出：'+child.pid)),15000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.connected)child.send({type:'weava-control',action:'shutdown'});else child.kill();});
 }
 try{
  const until=Date.now()+60000;
  while(Date.now()<until&&child.exitCode===null&&!launchError){
   try{const response=await fetch(origin+'/__health',{headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8')},signal:AbortSignal.timeout(1000)});if(response.ok)return {origin,headers:{'x-weava-upgrade-probe':token},stop,pid:child.pid!};}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('隔离网站未能启动：'+(launchError?.message??errors));
 }catch(error){await stop();throw error;}
}
