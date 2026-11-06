import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {Site} from '../packages/core/src/site.ts';
import {entrySchema} from '../packages/contracts/src/index.ts';
import {atomic,json,hash} from '../packages/manager/src/state.ts';
import {maintenance,saveRobots} from '../packages/manager/src/proxy.ts';
const base='D:/Tools/cache/weava/tasks/seo-upgrade-20261105',home=join(base,'installation'),root=join(base,'sites/blog');
const target=process.argv[2]??'E:/WeavaRuntime/programs/weava-0.2.1-seo-20261105',old='E:/WeavaRuntime/programs/weava-0.2.0-windows-host-20261105';
const manager=join(home,'manager/manager.mjs'),id='blog',origin='http://127.0.0.1:4654',backend='http://127.0.0.1:4652';
function launch(args:string[]){const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);return {child,done:new Promise<any>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch{resolve(out);}});})};}
const cli=(args:string[])=>launch(args).done;
const targetId=json(join(target,'program.json')).id;
if(!existsSync(join(home,'installation.json'))){
 const installed=spawnSync(process.execPath,[join(target,'runtime/manager.mjs'),'--installation',home,'install','--program',target,'--sites-root',join(base,'sites'),'--backup-root',join(base,'recovery')],{windowsHide:true,encoding:'utf8'});assert.equal(installed.status,0,installed.stderr);
 await cli(['program','add','--from',old]);const oldId=json(join(old,'program.json')).id;
 await cli(['site','create',id,'--port','4652','--template','blog','--theme','newsletter','--program',oldId,'--domain',backend]);
 const config=json(join(root,'site.json'));atomic(join(root,'site.json'),{...config,features:['content','media']});
 const site=new Site(root);for(let i=0;i<18;i++)site.saveEntry(entrySchema.parse({id:'story-'+i,kind:'content',type:'post',title:'保留文章 '+i,path:'/posts/story-'+i+'/',status:'published',document:{version:1,format:'markdown',source:'## 原有正文\n\n升级不应该改变这份正文。'}}),null);
 site.store.put('redirect','/old-story/',{target:'/posts/story-0/',entryId:'story-0'},null);site.publish();site.close();
}
await cli(['program','add','--from',target,'--default']);
await cli(['host','start']);await cli(['site','start',id]);
const nginxRoot=join(base,'nginx');mkdirSync(join(nginxRoot,'logs'),{recursive:true});mkdirSync(join(nginxRoot,'temp'),{recursive:true});
const proxy=await cli(['site','deployment-info',id,'--proxy-origin',origin]);
const configuration=`worker_processes 1;\npid "${join(nginxRoot,'nginx.pid').replaceAll('\\','/')}";\nerror_log "${join(nginxRoot,'error.log').replaceAll('\\','/')}";\nevents { worker_connections 128; }\nhttp { access_log off; server { listen 127.0.0.1:4654; server_name _; ${proxy.nginx} } }`;
writeFileSync(join(nginxRoot,'nginx.conf'),configuration);
const nginx='D:/Tools/nginx-1.30.6/nginx.exe';
const check=spawnSync(nginx,['-t','-p',nginxRoot+'/', '-c','nginx.conf'],{windowsHide:true,encoding:'utf8'});assert.equal(check.status,0,check.stderr);
const master=spawn(nginx,['-p',nginxRoot+'/', '-c','nginx.conf'],{cwd:nginxRoot,windowsHide:true,stdio:'ignore'});
const results:any={targetId,nginxSyntax:true};
try{
 for(let n=0;n<100;n++){try{if((await fetch(origin)).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const robots=await fetch(origin+'/robots.txt').then(r=>r.text());saveRobots(home,id,200,robots);maintenance(home,id,true,'proxy-test');
 for(const path of ['/','/posts/story-0/','/no-such-page']){const r=await fetch(origin+path);assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'60');assert.equal(r.headers.get('cache-control'),'no-store');assert(!r.headers.get('x-robots-tag'));await r.body?.cancel();}
 assert.equal(await fetch(origin+'/robots.txt').then(r=>r.text()),robots);
 await cli(['site','stop',id]);assert.equal((await fetch(origin+'/posts/story-0/')).status,503);assert.equal((await fetch(origin+'/robots.txt')).status,200);
 maintenance(home,id,false,'proxy-test');assert.equal((await fetch(origin+'/')).status,503); // upstream outage is also 503
 await cli(['site','start',id]);assert.equal((await fetch(origin+'/')).status,200);results.proxy={maintenance503:true,retryAfter:true,noStore:true,robotsPreserved:true,stoppedUpstream503:true};
 const before=await cli(['site','status',id]);
 const rehearsal=await cli(['site','update',id,'--to',targetId,'--check']);assert(rehearsal.passed);assert.equal((await cli(['site','status',id])).runtime.pid,before.runtime.pid);results.onlinePreflight=rehearsal;
 // A candidate-only metadata mutation is caught before any stop or selection.
 const extension=join(root,'extensions/index.mjs');writeFileSync(extension,"export default()=>({id:'seo-fault',apiVersion:1,metadata(){return process.env.WEAVA_RESOURCE_ROOT?{canonical:'https://wrong.example/'}:null;}});");
 await cli(['site','restart',id]);const stable=await cli(['site','status',id]),pointer=readFileSync(join(root,'program.json'),'utf8');
 let blocked=false;try{await cli(['site','update',id,'--to',targetId]);}catch(error){blocked=String(error).includes('SEO 对比未通过');}assert(blocked);assert.equal(readFileSync(join(root,'program.json'),'utf8'),pointer);assert.equal((await cli(['site','status',id])).runtime.pid,stable.runtime.pid);assert.equal((await fetch(origin)).status,200);results.seoFailurePreservesRunningSite=true;
 writeFileSync(extension,"export default()=>({id:'seo-fault',apiVersion:1});");await cli(['site','restart',id]);
 const active=launch(['site','update',id,'--to',targetId]);let done=false;active.done.finally(()=>{done=true;}).catch(()=>{});let beforeStop200=0,maintenance503=0,other:number[]=[];
 while(!done){const r=await fetch(origin+'/posts/story-0/');if(r.status===200)beforeStop200++;else if(r.status===503){maintenance503++;assert.equal(r.headers.get('retry-after'),'60');}else other.push(r.status);await r.body?.cancel();await new Promise(r=>setTimeout(r,75));}
 const updated=await active.done;assert(updated.verified);assert(updated.seo.passed);assert(beforeStop200>0&&maintenance503>0);assert.deepEqual(other,[]);assert.equal((await fetch(origin+'/old-story/',{redirect:'manual'})).status,301);results.updated=updated;results.publicResponses={beforeStop200,maintenance503,other};
 // Initialization runs only on real activation. It must not expose a faulty service.
 writeFileSync(extension,"export default()=>({id:'seo-fault',apiVersion:1,start(){if(process.env.WEAVA_UPGRADE_PROBE)throw new Error('injected initialization failure');}});");
 await cli(['site','restart',id]);const beforeFailure=readFileSync(join(root,'program.json'),'utf8');let failed=false;try{await cli(['site','update',id,'--to',targetId]);}catch(error){failed=String(error).includes('injected initialization failure');}assert(failed);assert.equal(readFileSync(join(root,'program.json'),'utf8'),beforeFailure);assert.equal((await fetch(origin)).status,200);results.startFailureRecovered=true;
 writeFileSync(extension,"export default()=>({id:'seo-fault',apiVersion:1});");
 writeFileSync(join(base,'integration-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{
 const quit=spawnSync(nginx,['-p',nginxRoot+'/', '-c','nginx.conf','-s','quit'],{windowsHide:true,encoding:'utf8'});if(quit.status)console.error(quit.stderr);
 await cli(['host','stop']).catch(()=>{});if(master.exitCode===null)await new Promise(r=>master.once('exit',r));
}
