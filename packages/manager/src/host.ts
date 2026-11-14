import {createServer,createConnection} from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,appendFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {loadInstallation,saveInstallation,selected,descriptor,inspect,atomic,json,alive,hash} from './state.ts';
export function pipeName(home:string){return process.platform==='win32'?'\\\\.\\pipe\\weava-'+hash(home.toLowerCase()).slice(0,24):join(home,'host.sock');}
function secret(home:string){return readFileSync(join(home,'control-token'),'utf8');}
export async function requestHost(home:string,action:string,args:any={}):Promise<any>{
 return new Promise((resolve,reject)=>{
  const socket=createConnection(pipeName(home));let data='';
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('托管操作超时，请查看 host status 和日志。'));},(args.timeoutMs??300000)+65000);
  socket.on('connect',()=>socket.write(JSON.stringify({action,args,token:secret(home)})+'\n'));
  socket.on('data',b=>{data+=b;if(data.includes('\n')){clearTimeout(timer);socket.end();try{const result=JSON.parse(data.split('\n')[0]);if(result.error)reject(new Error(result.error));else resolve(result.value);}catch(e){reject(e);}}});
  socket.once('error',e=>{clearTimeout(timer);reject(e);});socket.once('end',()=>{clearTimeout(timer);if(!data)reject(new Error('托管进程未返回结果。'));});
 });
}
export async function ensureHost(home:string,node:string,entry:string){
 try{return await requestHost(home,'status');}catch{}
 const child=spawn(node,[entry,'--installation',home,'host','run'],{cwd:home,detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,WEAVA_INSTALLATION:home}});child.unref();
 const until=Date.now()+15000;
 while(Date.now()<until){try{return await requestHost(home,'status');}catch{}await new Promise(r=>setTimeout(r,150));}
 throw new Error('托管进程未能启动，请运行 host run 查看原因。');
}
interface Managed {child?:ChildProcess;status:string;nonce:string;failures:number;wanted:boolean;programId?:string;root:string;launch:{validation:boolean;port:number;probeToken?:string};timer?:ReturnType<typeof setTimeout>;ready?:Promise<any>}
export async function serveHost(home:string){
 const install=loadInstallation(home);mkdirSync(join(home,'logs'),{recursive:true});
 if(!existsSync(join(home,'control-token')))writeFileSync(join(home,'control-token'),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
 const managed=new Map<string,Managed>();let closing=false;
 function log(id:string,bytes:Buffer|string){
  const file=join(home,'logs',id+'.log');
  if(existsSync(file)&&statSync(file).size>8*1024*1024){const tail=readFileSync(file).subarray(-4*1024*1024);writeFileSync(file,tail);}
  appendFileSync(file,bytes);
 }
 async function start(id:string,validation=false,port?:number,probeToken?:string){
  const current=managed.get(id);if(current?.child&&current.child.exitCode===null){if(current.ready)return current.ready;return view(id,current);}
  const config=loadInstallation(home),registered=config.sites[id];if(!registered)throw new Error('网站未登记：'+id);
  const root=registered.root,site={...descriptor(root)},program=selected(config,root),database=inspect(root);
  if(port!==undefined){if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('端口无效。');site.port=port;}
  const journal=join(root,'.weava-update.json');
  if(existsSync(journal)&&!['complete','rolled-back'].includes(json(journal).status)&&!validation)throw new Error('网站更新尚未完成，请执行 site recover。');
  if(database.schemaVersion!==program.manifest.schemaVersion)throw new Error('网站数据库与所选程序不兼容，请执行 site update。');
  const oldRuntime=existsSync(join(root,'runtime.json'))?json(join(root,'runtime.json')):null;
  if(oldRuntime?.status!=='stopped'&&oldRuntime?.pid&&alive(oldRuntime.pid))throw new Error('站点已有未受本托管器管理的进程，拒绝重复启动。');
  const state:Managed={root,nonce:randomUUID(),status:'starting',failures:current?.failures??0,wanted:true,programId:program.manifest.id,launch:{validation,port:site.port,probeToken}};managed.set(id,state);
  const child=spawn(config.node,[join(program.root,'web/server/entry.mjs')],{cwd:program.root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,...site.environment,WEAVA_VALIDATION:validation?'1':'0',WEAVA_UPGRADE_PROBE:validation?probeToken??'':'',WEAVA_SITE:root,WEAVA_SITE_ID:id,WEAVA_PROGRAM_ID:program.manifest.id,WEAVA_INSTALLATION:home,WEAVA_PROGRAM_ROOT:program.root,WEAVA_FRAMEWORK:program.root,WEAVA_ADMIN_DIST:join(program.root,'admin'),WEAVA_WORKER:join(program.root,'runtime/worker.mjs'),WEAVA_SOURCE_WORKER:'0',WEAVA_DATABASE_MODE:'open',WEAVA_RUN_NONCE:state.nonce,HOST:'127.0.0.1',PORT:String(site.port),NODE_ENV:'production'}});
  state.child=child;child.stdout!.on('data',b=>log(id,b));child.stderr!.on('data',b=>log(id,b));
  child.on('error',e=>log(id,String(e)+'\n'));
  child.on('exit',(code,signal)=>{
   state.child=undefined;state.status=state.wanted?'failed':'stopped';log(id,JSON.stringify({event:'exit',code,signal})+'\n');
   if(state.wanted&&!closing){state.failures++;if(state.failures<5)state.timer=setTimeout(()=>{void start(id,state.launch.validation,state.launch.port,state.launch.probeToken).catch(e=>log(id,String(e)+'\n'));},Math.min(30000,1000*2**state.failures));}
  });
  state.ready=(async()=>{
   const until=Date.now()+60000;
   while(Date.now()<until&&child.exitCode===null){
    try{
     const response=await fetch('http://127.0.0.1:'+site.port+'/__health',{signal:AbortSignal.timeout(1000),headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8')}});
     const health=await response.json() as any;
     if(response.ok&&health.nonce===state.nonce){state.status='running';state.ready=undefined;const healthy=setTimeout(()=>{state.failures=0;},60000);healthy.unref();return view(id,state);}
    }catch{}
    await new Promise(r=>setTimeout(r,200));
   }
   state.wanted=false;state.ready=undefined;state.status='failed';if(child.connected)child.send({type:'weava-control',action:'shutdown'});throw new Error('网站启动未通过就绪检查，请查看 site logs。');
  })();
  return state.ready;
 }
 function view(id:string,state:Managed){return {id,status:state.status,pid:state.child?.pid??null,nonce:state.nonce,programId:state.programId,failures:state.failures};}
 async function control(state:Managed,action:string,timeoutMs=300000){
  const child=state.child;if(!child||child.exitCode!==null)return;
  const id=randomUUID();
  return new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>{child.off('message',receive);reject(new Error('网站仍有任务或请求运行，已取消本次停止。'));},timeoutMs+1000);
   const receive=(message:any)=>{if(message?.controlId!==id)return;clearTimeout(timer);child.off('message',receive);message.error?reject(new Error(message.error)):resolve(message.value);};
   child.on('message',receive);child.send({type:'weava-control',controlId:id,action,timeoutMs});
  });
 }
 async function stop(id:string,timeoutMs=300000){
  const state=managed.get(id);
  if(!state)return {id,status:'stopped'};
  state.wanted=false;clearTimeout(state.timer);
  try{
   await control(state,'drain',timeoutMs);
   const child=state.child;
   if(child){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('网站关闭未完成，请检查日志。')),30000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.send({type:'weava-control',action:'shutdown'});});}
  }catch(e){state.wanted=true;await control(state,'resume',1000).catch(()=>{});throw e;}
  state.status='stopped';return view(id,state);
 }
 let mutation=Promise.resolve<any>(null);
 const server=createServer(socket=>{
  let data='';socket.setTimeout(370000,()=>socket.destroy());
  socket.on('data',b=>{
   data+=b;if(data.length>1024*1024){socket.destroy();return;}
   const index=data.indexOf('\n');if(index<0)return;const line=data.slice(0,index);data='';
   const handle=async()=>{
    const message=JSON.parse(line);if(message.token!==secret(home))throw new Error('本机托管凭据无效。');
    const {action,args}=message;
    if(action==='status')return {protocol:2,pid:process.pid,sites:[...managed].map(([id,s])=>view(id,s))};
    if(action==='start')return start(args.id,args.validation===true,args.port,args.probeToken);
    if(action==='activate'||action==='initialize'){
      const state=managed.get(args.id);if(!state)throw new Error('网站未运行。');
      await control(state,action==='initialize'?'initialize':'resume');
      if(action==='activate')state.launch={...state.launch,validation:false,probeToken:undefined};
      return view(args.id,state);
    }
    if(action==='stop')return stop(args.id,args.timeoutMs);
    if(action==='restart'){await stop(args.id,args.timeoutMs);return start(args.id);}
    if(action==='shutdown'){
     closing=true;for(const id of managed.keys())await stop(id,args.timeoutMs);
     setTimeout(()=>{server.close();process.exit(0);},100).unref();return {stopped:true};
    }
    throw new Error('未知托管操作：'+action);
   };
   let readOnly=false;try{readOnly=JSON.parse(line).action==='status';}catch{socket.end(JSON.stringify({error:'托管请求不是有效 JSON。'})+'\n');return;}
   const result=readOnly?handle():(mutation=mutation.catch(()=>{}).then(handle));
   void result.then(value=>socket.end(JSON.stringify({value})+'\n'),error=>socket.end(JSON.stringify({error:error.message})+'\n'));
  });
 });
 // A startup task has a different Windows logon token from an interactive CLI,
 // even for the same account. Authenticate requests with the installation token.
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen({path:pipeName(home),readableAll:true,writableAll:true},resolve);});
 atomic(join(home,'host.json'),{pid:process.pid,nonce:randomUUID(),startedAt:new Date().toISOString()});
 for(const[id,site]of Object.entries(install.sites))if(site.autostart)void start(id).catch(e=>log(id,String(e)+'\n'));
 process.on('SIGINT',()=>{void Promise.all([...managed.keys()].map(id=>stop(id))).then(()=>{server.close();process.exit(0);});});
}

