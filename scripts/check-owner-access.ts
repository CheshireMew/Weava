import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Site } from '../packages/core/src/site.ts';
import { randomBytes } from 'node:crypto';

// Isolated HTTP and CLI checks. No browser, build, or real account changes.
const framework=resolve(import.meta.dirname,'..'),output='D:/Tools/cache/weava/owner-access-'+Date.now();
const programArg=process.argv.indexOf('--program'),programRoot=programArg<0?null:resolve(process.argv[programArg+1]);
const cliArgs=programRoot?[join(programRoot,'runtime/weava.mjs')]:['--import','tsx',join(framework,'packages/cli/src/index.ts')];
const root=join(output,'site'),adminDist=join(output,'admin');mkdirSync(adminDist,{recursive:true});
writeFileSync(join(adminDist,'index.html'),'<html><body>isolated-owner-access</body></html>');
const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));
const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));
const origin='http://127.0.0.1:'+port,site=new Site(root),cliToken=site.cliToken();
writeFileSync(join(root,'site.json'),JSON.stringify({port}));site.close();
const env={...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,WEAVA_ADMIN_DIST:adminDist,WEAVA_SOURCE_WORKER:'1',ASTRO_TELEMETRY_DISABLED:'1',TEMP:output,TMP:output};
let child:ChildProcess|undefined,serverPid=0,log='';
const checks:Record<string,boolean>={};
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function call(path:string,body?:unknown,headers:Record<string,string>={}) {
  const response=await fetch(origin+'/api/admin/v1/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let value:any;try{value=JSON.parse(text);}catch{value={error:text};}return {response,value};
}
function run(args:string[]) {
  const result=spawnSync(process.execPath,[...cliArgs,'--site',root,...args],{cwd:framework,windowsHide:true,encoding:'utf8',timeout:15000,env});
  assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout);
}
async function boot() {
  log='';serverPid=0;
  child=spawn(process.execPath,[...cliArgs,'--site',root,programRoot?'start':'dev','--port',String(port)],{cwd:framework,windowsHide:true,stdio:['ignore','pipe','pipe'],env});
  for(const stream of [child.stdout,child.stderr])stream?.on('data',bytes=>{log+=String(bytes);appendFileSync(join(output,'server.log'),bytes);});
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw new Error('Launcher exited; see '+join(output,'server.log'));
    try{
      const response=await fetch(origin+'/__health',{headers:{Authorization:'Bearer '+cliToken},signal:AbortSignal.timeout(3000)});
      if(response.ok){const health=await response.json() as {site:string;pid:number};assert.equal(resolve(health.site),resolve(root));serverPid=health.pid;return;}
    }catch{}await delay(200);
  }
  throw new Error('Server did not start');
}
async function stop() {
  if(serverPid){process.kill(serverPid);serverPid=0;}
  if(child&&child.exitCode===null){await Promise.race([new Promise(done=>child!.once('exit',done)),delay(5000)]);if(child.exitCode===null)child.kill();}
}
const password='violet river lantern '+randomBytes(8).toString('hex'),nextPassword='silver mountain library '+randomBytes(8).toString('hex');
let cookie='';
async function login(username:string,value:string) {
  const reply=await call('login',{username,password:value});assert.equal(reply.response.status,200,JSON.stringify(reply.value));cookie=reply.response.headers.get('set-cookie')!.split(';')[0];return cookie;
}
try{
  await boot();
  for(let i=0;i<60&&!log.includes('#owner-access=');i++)await delay(100);
  const match=log.match(/http:\/\/127\.0\.0\.1:\d+\/admin\/#owner-access=([a-f0-9]{64})/);assert(match,'The first-launch console must contain a usable setup link');const token=match[1];
  assert.equal((await call('session')).value.initialized,false);assert(!JSON.stringify((await call('session')).value).includes(token));checks.firstLaunchAndSecretDelivery=true;
  assert.equal((await call('account',undefined,{Authorization:'Bearer '+token})).response.status,401);
  assert.equal((await call('owner/setup-link',{})).response.status,401);checks.setupGrantHasNoAdminPrivileges=true;
  let reply=await call('account-access',{token});assert.equal(reply.response.status,200);assert.equal(reply.value.mode,'initialize');assert.equal(reply.response.headers.get('set-cookie'),null);
  reply=await call('account-access/complete',{token,username:'nico',password,confirmPassword:'wrong'});assert.equal(reply.response.status,400);assert.equal((await call('session')).value.initialized,false);
  reply=await call('account-access/complete',{token,username:'nico',password,confirmPassword:password});assert.equal(reply.response.status,200);assert.equal((await call('session')).value.authenticated,false);
  assert.equal((await call('account-access',{token})).response.status,403);checks.singleUseSetupAndNormalLogin=true;
  const oldCookie=await login('nico',password);assert.equal((await call('account',undefined,{Cookie:oldCookie})).response.status,200);
  const first=run(['owner','reset-link']),second=run(['owner','reset-link']);const old=new URL(first.url).hash.split('=')[1],reset=new URL(second.url).hash.split('=')[1];
  assert.equal((await call('account-access',{token:old})).response.status,403);assert.equal((await call('account',undefined,{Cookie:oldCookie})).response.status,200);
  reply=await call('account-access/complete',{token:reset,username:'newnico',password:nextPassword,confirmPassword:nextPassword},{Origin:'https://attacker.test'});assert.equal(reply.response.status,403);
  assert.equal((await call('account-access',{token:reset})).response.status,200);checks.reissueAndOriginValidation=true;
  reply=await call('account-access/complete',{token:reset,username:'newnico',password:nextPassword,confirmPassword:nextPassword});assert.equal(reply.response.status,200);
  assert.equal((await call('account',undefined,{Cookie:oldCookie})).response.status,401);assert.equal((await call('login',{username:'nico',password})).response.status,401);
  await login('newnico',nextPassword);assert.equal((await call('account',undefined,{Cookie:cookie})).value.username,'newnico');checks.resetAndOldCredentialRevocation=true;
  const state=run(['owner','status']);assert.equal(state.username,'newnico');assert(!JSON.stringify(state).includes(reset));checks.localStatusHidesSecrets=true;
  await stop();await boot();
  for(let i=0;i<60&&!log.includes('账户名：newnico');i++)await delay(100);
  assert(log.includes('账户名：newnico'));assert(!log.includes('#owner-access='));assert(!log.includes(password));assert(!log.includes(nextPassword));checks.normalStartupDoesNotRedisplayCredentials=true;
}finally{await stop();}
const report={passed:true,platform:process.platform,output,programRoot,mode:programRoot?'isolated compiled HTTP, startup and CLI':'isolated source HTTP, startup and CLI',checks};
writeFileSync(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
