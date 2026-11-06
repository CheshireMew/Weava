import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,openSync,closeSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,spawnSync,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { Site } from '../packages/core/src/site.ts';
import { entrySchema } from '@weava/contracts';
import { uploadMedia } from '../packages/core/src/media.ts';
import { Analytics } from '../packages/core/src/analytics.ts';

// Uses the selected production program, isolated data, a local TLS proxy and a fresh headless browser.
// Supply an official Windows nginx directory plus disposable example.com certificate/key files.
const framework=resolve(import.meta.dirname,'..');
const output=process.env.WEAVA_SECURITY_OUTPUT??'D:/Tools/cache/weava/tasks/security-repairs-20261105';
const nginxRoot=process.env.WEAVA_TEST_NGINX;
if(!nginxRoot)throw new Error('请通过 WEAVA_TEST_NGINX 指定用于本机验证的 nginx 目录。');
const proxyFolder=join(output,'proxy'),root=join(output,'site');mkdirSync(root,{recursive:true});
const certificate=readFileSync(join(proxyFolder,'cert.pem'));
const nginx=join(nginxRoot,'nginx.exe'),config=join(proxyFolder,'validation.conf');
const program=JSON.parse(readFileSync(join(framework,'dist/current.json'),'utf8')).root;
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
const nodePort=await freePort(),httpPort=await freePort(),httpsPort=await freePort();
const origin='https://example.com:'+httpsPort,direct='http://127.0.0.1:'+nodePort;
const password=randomBytes(32).toString('hex'),site=new Site(root);site.setOwner(password);
const file=await uploadMedia(site,Buffer.from('private attachment security fixture'),'private.txt');
site.saveEntry(entrySchema.parse({id:'private',kind:'page',title:'Private',path:'/private/',status:'published',visibility:'private',document:{version:1,format:'markdown',source:'[private]('+file.value.url.replaceAll('/','&#47;')+')'}}),site.store.get('entry','private')?.revision??null);
site.saveEntry(entrySchema.parse({id:'public',kind:'page',title:'Public',path:'/public/',status:'published',document:{version:1,format:'markdown',source:'## Public\n\nPublic article'}}),site.store.get('entry','public')?.revision??null);
const settings=site.settings();site.saveSettings({...settings.value,domain:origin,advertisements:{siteTop:{enabled:true,html:'<div id="ad">Isolated ad</div><script>window.adScriptRan=true;try{parent.document.body.dataset.adEscaped="yes"}catch{};fetch("/api/admin/v1/account",{credentials:"include"}).then(r=>r.json()).then(data=>{document.body.dataset.accountRead=String(!!data.username)}).catch(()=>{document.body.dataset.accountRead="blocked"})</script>'}}},settings.revision);
site.publish();const bearer=site.cliToken();site.close();
const telemetry=new Analytics(root);try{telemetry.raw.exec('DELETE FROM events;DELETE FROM event_context;DELETE FROM page_activity;DELETE FROM crawler_requests;DELETE FROM analytics_ingress;');}finally{telemetry.close();}
let backend:ChildProcess|undefined,proxy:ChildProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function startBackend(minimumFree?:string){
  const log=openSync(join(output,'production.log'),'a');
  const child=spawn(process.execPath,[join(program,'web/server/entry.mjs')],{cwd:framework,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,WEAVA_ADMIN_DIST:join(program,'admin'),WEAVA_WORKER:join(program,'runtime/worker.mjs'),WEAVA_SOURCE_WORKER:'0',HOST:'127.0.0.1',PORT:String(nodePort),WEAVA_TRUST_PROXY:'1',WEAVA_TRUSTED_PROXIES:'127.0.0.1,::1',WEAVA_REQUIRE_HTTPS:'1',...(minimumFree?{WEAVA_ANALYTICS_MIN_FREE_BYTES:minimumFree}:{}),TEMP:output,TMP:output}});closeSync(log);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('生产服务退出，查看 production.log');try{if((await fetch(direct+'/__health')).ok)return child;}catch{}await new Promise(done=>setTimeout(done,100));}
  child.kill();throw new Error('生产服务启动超时。');
}
async function stop(child?:ChildProcess){if(child&&child.exitCode===null){child.kill();await new Promise<void>(done=>child.once('exit',()=>done()));}}
async function tls(path:string,body?:unknown,extra:Record<string,string>={}){
  return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;text:string}>((done,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const request=httpsRequest({hostname:'127.0.0.1',port:httpsPort,servername:'example.com',ca:certificate,path,method:data===undefined?'GET':'POST',headers:{Host:'example.com','User-Agent':'Mozilla/5.0 SecurityRegression',...(data?{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(data))}:{}),...extra}},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>done({status:response.statusCode!,headers:response.headers,text:Buffer.concat(chunks).toString('utf8')}));response.on('error',reject);});request.on('error',reject);request.end(data);
  });
}
try {
  const template=readFileSync(join(framework,'deploy/nginx.conf.example'),'utf8')
    .replace('include mime.types;',`include "${join(nginxRoot,'conf/mime.types').replaceAll('\\','/')}";`)
    .replaceAll('listen 80','listen 127.0.0.1:'+httpPort).replaceAll('listen 443','listen 127.0.0.1:'+httpsPort)
    .replaceAll('127.0.0.1:4322','127.0.0.1:'+nodePort)
    .replaceAll('D:/WeavaTLS/fullchain.pem',join(proxyFolder,'cert.pem').replaceAll('\\','/'))
    .replaceAll('D:/WeavaTLS/privkey.pem',join(proxyFolder,'key.pem').replaceAll('\\','/'));
  writeFileSync(config,template);
  const args=['-p',nginxRoot.replaceAll('\\','/')+'/','-c',config.replaceAll('\\','/')];
  const checked=spawnSync(nginx,[...args,'-t'],{cwd:nginxRoot,windowsHide:true,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);console.log('nginx template syntax: passed');
  backend=await startBackend();
  proxy=spawn(nginx,args,{cwd:nginxRoot,windowsHide:true,stdio:'ignore'});
  let ready=false;for(let i=0;i<50;i++){try{if((await tls('/__health')).status===200){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}assert(ready,'TLS proxy did not start');
  const redirect=await new Promise<number>((done,reject)=>{const request=httpRequest({hostname:'127.0.0.1',port:httpPort,path:'/public/',headers:{Host:'example.com'}},response=>{response.resume();done(response.statusCode!);});request.on('error',reject);request.end();});
  assert.equal(redirect,308);
  const early=await new Promise<number>((done,reject)=>{
    const request=httpsRequest({hostname:'127.0.0.1',port:httpsPort,servername:'example.com',ca:certificate,path:'/api/admin/v1/import/wxr',method:'POST',headers:{Host:'example.com','Content-Type':'application/json','Content-Length':String(64*1024*1024)}},response=>{response.resume();done(response.statusCode!);request.destroy();});
    request.setTimeout(3000,()=>request.destroy(new Error('Proxy buffered an unauthenticated upload before checking authentication')));
    request.on('error',reject);request.write('{');
  });assert.equal(early,401);
  if(process.argv.includes('--proxy-only')) {console.log('proxy limits, TLS redirect and early upload authentication: passed');}
  else {
  assert.equal((await fetch(direct+'/public/')).status,403);
  assert.equal((await tls('/api/admin/v1/account')).status,401);
  assert.equal((await tls('/private/')).status,404);
  assert.equal((await tls(file.value.url)).status,404);
  assert.equal((await fetch(direct+'/api/admin/v1/account',{headers:{Authorization:'Bearer '+bearer}})).status,200);
  const login=await tls('/api/admin/v1/login',{password,username:'owner'},{'X-Forwarded-For':'203.0.113.123','X-Forwarded-Proto':'http'});assert.equal(login.status,200,login.text);
  const setCookie=login.headers['set-cookie']?.[0]??'';assert(setCookie.includes('Secure')&&setCookie.includes('HttpOnly')&&setCookie.includes('SameSite=Strict'));
  const cookie=setCookie.split(';')[0];assert.equal((await tls(file.value.url,undefined,{Cookie:cookie})).status,200);
  assert.equal((await tls('/api/admin/v1/logout',{}, {Cookie:cookie})).status,200);
  assert.equal((await tls('/api/admin/v1/account',undefined,{Cookie:cookie})).status,401);
  const sample={id:'csv-regression-'+randomBytes(8).toString('hex'),kind:'view',path:'/public/',ts:new Date().toISOString(),campaign:{source:'=1+1',campaign:'CSV regression'}};
  assert.equal((await tls('/api/v1/analytics',sample)).status,200);
  const csv=await tls('/api/admin/v1/analytics/export?dataset=campaigns',undefined,{Authorization:'Bearer '+bearer});assert.equal(csv.status,200,csv.text);assert(csv.text.includes('"\t=1+1"'));assert(!csv.text.includes('"=1+1"'));
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP example.com 127.0.0.1','--no-proxy-server']});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  const owner=await tls('/api/admin/v1/login',{password,username:'owner'}),session=(owner.headers['set-cookie']?.[0]??'').split(';')[0].split('=')[1];
  await context.addCookies([{name:'weava-session',value:session,domain:'example.com',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();await page.goto(origin+'/public/');
  const frame=page.frames().find(item=>item.parentFrame()!==null)!;assert(frame);
  await frame.waitForFunction(()=>Boolean((window as any).adScriptRan));
  assert.equal(await page.evaluate(()=>document.body.dataset.adEscaped),undefined);
  assert.equal(await frame.evaluate(()=>{try{return !!parent.document;}catch{return false;}}),false);
  await frame.waitForFunction(()=>document.body.dataset.accountRead!==undefined);
  assert.notEqual(await frame.evaluate(()=>document.body.dataset.accountRead),'true');
  assert(!(await page.locator('iframe[data-weava-ad]').getAttribute('sandbox'))?.includes('allow-same-origin'));
  await browser.close();browser=undefined;
  let throttled=false;for(let i=0;i<12;i++){
    const batch=Array.from({length:100},(_,n)=>({...sample,id:`rate-regression-${i}-${n}-${randomBytes(4).toString('hex')}`,campaign:undefined}));
    const response=await tls('/api/v1/analytics',batch);
    if(response.status===429){assert(Number(response.headers['retry-after'])>0);throttled=true;break;}
    assert.equal(response.status,200,response.text);
  }assert(throttled,'anonymous events were not throttled');
  await stop(backend);backend=await startBackend(String(Number.MAX_SAFE_INTEGER));
  const paused=await tls('/api/v1/analytics',sample);assert.equal(paused.status,503,paused.text);assert.equal(paused.headers['retry-after'],'60');
  assert.equal((await tls('/public/')).status,200);
  console.log(JSON.stringify({passed:true,production:program,checks:['TLS proxy and HTTP redirect','HTTPS enforcement','anonymous and owner private media','Secure session and logout revocation','CSV formula neutralization','advertisement origin and credential isolation','anonymous rate limit with Retry-After','low disk pauses telemetry without breaking pages'],output}));
  }
} finally {
  await browser?.close();
  if(proxy) {spawnSync(nginx,['-p',nginxRoot.replaceAll('\\','/')+'/','-c',config.replaceAll('\\','/'),'-s','quit'],{cwd:nginxRoot,windowsHide:true,encoding:'utf8'});await stop(proxy);}
  await stop(backend);
}
