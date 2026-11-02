import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync,openSync,closeSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Site } from '../packages/core/src/site.ts';
import { totpCode } from '../packages/core/src/two-factor.ts';

// Current source, isolated data, HTTP requests only. No browser, package or real instance.
const framework=resolve(import.meta.dirname,'..'),output='D:/Tools/cache/weava/account-security-'+Date.now();
const root=join(output,'site'),adminDist=join(output,'admin'),password=randomBytes(24).toString('hex');
mkdirSync(adminDist,{recursive:true});writeFileSync(join(adminDist,'index.html'),'<html><body>isolated-admin-entry</body></html>');
const site=new Site(root);site.setOwner(password);site.close();
const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));
const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));
const origin='http://127.0.0.1:'+port,log=openSync(join(output,'server.log'),'a');
const child=spawn(process.execPath,[join(framework,'node_modules/astro/bin/astro.mjs'),'dev','--port',String(port),'--host','127.0.0.1'],{
  cwd:join(framework,'apps/web'),windowsHide:true,stdio:['ignore',log,log],
  env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,WEAVA_ADMIN_DIST:adminDist,WEAVA_SOURCE_WORKER:'1',WEAVA_TRUST_PROXY:'1',WEAVA_TRUSTED_PROXIES:'127.0.0.1,::1',PORT:String(port),HOST:'127.0.0.1',ASTRO_TELEMETRY_DISABLED:'1',TEMP:output,TMP:output},
});closeSync(log);
const results:Record<string,boolean>={};
let cookie='';
async function call(path:string,body?:unknown,options:{anonymous?:boolean;bearer?:string;headers?:Record<string,string>}={}) {
  const response=await fetch(origin+'/api/admin/v1/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(!options.anonymous&&cookie?{Cookie:cookie}:{}),...(options.bearer?{Authorization:'Bearer '+options.bearer}:{}),...options.headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let value:any;try{value=JSON.parse(text);}catch{value={error:text};}return {response,value};
}
async function login(code?:string) {
  const {response,value}=await call('login',{username:'owner',password,code},{anonymous:true});assert.equal(response.status,200,JSON.stringify(value));
  const header=response.headers.get('set-cookie')!;assert(header.includes('HttpOnly'));assert(header.includes('SameSite=Strict'));cookie=header.split(';')[0];return cookie;
}
function cli(args:string[]) {return spawnSync(process.execPath,['--import','tsx',join(framework,'packages/cli/src/index.ts'),'--site',root,...args],{cwd:framework,windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,TEMP:output,TMP:output}});}
try {
  let ready=false;
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw new Error('Source server exited; see '+join(output,'server.log'));
    try{if((await fetch(origin+'/__health')).ok){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,200));
  }
  assert(ready,'Source server did not start');
  assert.equal((await call('account',undefined,{anonymous:true})).response.status,401);
  const first=await login();let account=await call('account');assert.equal(account.response.status,200);assert.equal(account.value.adminPath,'/admin');
  assert.equal((await call('account/admin-path',{password:'wrong',path:'/manage-private'})).response.status,403);
  let result=await call('account/admin-path',{password,path:'/manage-private'});assert.equal(result.response.status,200);
  for(const path of ['/admin','/admin/','/_admin/index.html']){const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);assert(!(await response.text()).includes('manage-private'));}
  const entry=await fetch(origin+'/manage-private/');assert.equal(entry.status,200);assert((await entry.text()).includes('isolated-admin-entry'));assert.equal(entry.headers.get('referrer-policy'),'no-referrer');
  const anonymous=JSON.stringify((await call('session',undefined,{anonymous:true})).value);assert(!anonymous.includes('manage-private'));
  results.privateEntryAndIndependentAuth=true;
  result=await call('logout',{});assert.equal(result.response.status,200);
  assert.equal((await fetch(origin+'/api/admin/v1/account',{headers:{Cookie:first}})).status,401);
  const second=await login();const third=await login();account=await call('account');
  result=await call('account/sessions/revoke',{password,id:'others'});assert.equal(result.response.status,200);
  assert.equal((await fetch(origin+'/api/admin/v1/account',{headers:{Cookie:second}})).status,401);assert.equal((await call('account')).response.status,200);
  results.logoutAndSelectiveRevocation=true;
  result=await call('account/two-factor/begin',{password});assert.equal(result.response.status,200);const secret=result.value.secret;
  const svg=(await import('qrcode')).default.create(result.value.uri);assert(svg.modules.size>20);
  result=await call('account/two-factor/confirm',{password,code:totpCode(secret)});assert.equal(result.response.status,200);const oldCodes:string[]=result.value.recoveryCodes;assert.equal(oldCodes.length,10);
  assert.equal((await fetch(origin+'/api/admin/v1/account',{headers:{Cookie:third}})).status,401);
  assert.equal((await call('login',{password,code:totpCode(secret)},{anonymous:true})).response.status,401);
  await login(oldCodes[0]);result=await call('account/two-factor/recovery-codes',{password,code:oldCodes[1]});assert.equal(result.response.status,200);const newCodes:string[]=result.value.recoveryCodes;
  assert.equal((await call('login',{password,code:oldCodes[2]},{anonymous:true})).response.status,401);
  await login(newCodes[0]);assert.equal((await call('login',{password,code:newCodes[0]},{anonymous:true})).response.status,401);
  results.twoFactorAndRecoveryRenewal=true;
  const oldCli=readFileSync(join(root,'cli-token'),'utf8');
  result=await call('account/cli-token',{password,code:newCodes[1],revokeSessions:true});assert.equal(result.response.status,200);
  assert.equal((await call('account',undefined,{anonymous:true,bearer:oldCli})).response.status,401);assert.equal((await call('account')).response.status,401);
  const freshCli=readFileSync(join(root,'cli-token'),'utf8');assert.notEqual(oldCli,freshCli);assert.equal((await call('account',undefined,{anonymous:true,bearer:freshCli})).response.status,200);
  results.externalCredentialRotation=true;
  await login(newCodes[2]);result=await call('account/cli-token',{password,code:newCodes[3],revokeSessions:false},{headers:{Origin:'https://other.test'}});assert.equal(result.response.status,403);
  assert.equal(readFileSync(join(root,'cli-token'),'utf8'),freshCli);
  const secure=await call('login',{password,code:newCodes[4]},{anonymous:true,headers:{'X-Forwarded-Proto':'https'}});assert.equal(secure.response.status,200);
  assert(secure.response.headers.get('set-cookie')!.includes('Secure'));
  results.originAndProxyBoundaries=true;
  const live=cli(['owner','rotate-cli-token']);assert.notEqual(live.status,0);assert.match(live.stdout+live.stderr,/运行|停止|占用/);results.liveOfflineRecoveryRejected=true;
  // Independent client identity here is the loopback address; get a clean bucket after successes.
  const limitedClient={anonymous:true,headers:{'X-Forwarded-For':'203.0.113.77'}};
  for(let i=0;i<5;i++)assert.equal((await call('login',{password:'wrong'},limitedClient)).response.status,401);
  const throttled=await call('login',{password},limitedClient);assert.equal(throttled.response.status,429);assert(Number(throttled.response.headers.get('retry-after'))>0);assert(throttled.value.details.retryAt>Date.now());results.retryAfter=true;
} finally {
  if(child.exitCode===null){child.kill();await new Promise<void>(done=>child.once('exit',()=>done()));}
}
const recoveredPassword='  violet meadow lantern phrase 2026!  ',file=join(output,'recovery-password.txt');writeFileSync(file,recoveredPassword+'\r\n');
const recovery=cli(['owner','recover','--username','recovered','--password-file',file,'--reset-two-factor','--rotate-cli-token']);assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);assert(!recovery.stdout.includes(recoveredPassword));
const status=cli(['owner','status']);assert.equal(status.status,0);const info=JSON.parse(status.stdout);assert.equal(info.username,'recovered');assert.equal(info.adminPath,'/manage-private');
const recovered=new Site(root);try{
  assert.equal(recovered.auth.account('').twoFactorEnabled,false);assert(recovered.authenticate(await recovered.login(recoveredPassword,'offline-recovered',{username:'recovered'})));
  const events=JSON.stringify(recovered.auth.account('').events);assert(!events.includes(recoveredPassword));assert(events.includes('account-recovered'));
}finally{recovered.close();}
results.offlineCompleteRecoveryAndPrivateStatus=true;
const report={passed:true,output,platform:process.platform,mode:'source HTTP and CLI; no browser or package',checks:results};writeFileSync(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
