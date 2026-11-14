import { programCommand } from '../../runtime-common/src/program-command.ts';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync,lstatSync,renameSync,statSync,symlinkSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync,backup} from 'node:sqlite';
import {atomic,json,hash,inspect,descriptor,deployment,selected,loadInstallation,updateInstallation,programFor,canonical,inside,noDirectoryLink,type Program} from './state.ts';
import {allFeatures,siteDescriptorSchema,deploymentSchema,validateFeatures,type Installation,type FeatureId} from '../../contracts/src/installation.ts';
import {assertSpace,authoredFingerprint,recoverFiles} from './recovery.ts';
import {repairSiteBuildLink} from './relink.ts';
import {siteStamp} from './public-inventory.ts';
const leaseScope=new AsyncLocalStorage<Record<string,string>>();
export async function withLease<T>(home:string,root:string,p:Program,fn:()=>Promise<T>):Promise<T>{
 const node=loadInstallation(home).node;
 const child=spawn(node,[join(p.root,'runtime/site-maintenance.mjs'),'lease',root],{cwd:p.root,windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,WEAVA_DATABASE_MODE:'open'}});
 let errors='';child.stderr?.on('data',b=>errors+=b);
 const environment=await new Promise<Record<string,string>>((resolve,reject)=>{child.once('error',reject);child.once('message',(m:any)=>resolve(m.environment));child.once('exit',()=>reject(new Error(errors||'无法取得实例维护占用。')));});
 try{return await leaseScope.run(environment,fn);}finally{if(child.connected)child.send({release:true});await new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',()=>resolve());});}
}
export function run(program:Program,node:string,entry:string,args:string[],env:Record<string,string>={}):Promise<any>{
  return programCommand({
    root: program.root, node, entry, args,
    env: { ...leaseScope.getStore(), WEAVA_DATABASE_MODE:'open', WEAVA_FRAMEWORK:program.root, WEAVA_PROGRAM_ROOT:program.root, WEAVA_ADMIN_DIST:join(program.root,'admin'), WEAVA_WORKER:join(program.root,'runtime/worker.mjs'), WEAVA_SOURCE_WORKER:'0', ...env },
    timeoutMs: 300000, json: 'last-line',
    timeoutMessage: '程序操作超时，操作记录已保留，请执行 site recover。',
    failureMessage: '程序操作失败：', invalidMessage: '程序未返回有效 JSON：',
  });
}
export function selection(installationRoot:string,p:Program,siteBuildId?:string,siteBuildHash?:string){return deploymentSchema.parse({version:2,programId:p.manifest.id,manifestHash:p.manifestHash,siteBuildId,siteBuildHash,installationRoot,selectedAt:new Date().toISOString()});}
export async function createSite(home:string,id:string,options:{path?:string;port:number;template:string;theme?:string;program?:string;domain?:string}){
  const install=loadInstallation(home),p=programFor(install,options.program),root=resolve(options.path??join(install.sitesRoot,id));
  if(install.sites[id]||existsSync(join(root,'site.json'))||existsSync(join(root,'weava.sqlite')))throw new Error('网站已经存在，不能使用模板覆盖。');
  noDirectoryLink(dirname(root));
  const value=siteDescriptorSchema.parse({version:2,id,port:options.port,features:options.template==='blank'?[]:['content','media','analytics',...(options.template==='blog'||options.template==='demo'?['engagement']:[])],template:options.template});
  if(Object.values(install.sites).some(r=>canonical(r.root)===canonical(root)))throw new Error('目录已属于其他网站。');
  mkdirSync(root,{recursive:true});atomic(join(root,'site.json'),value);atomic(join(root,'program.json'),selection(home,p));
  await run(p,install.node,'site-maintenance.mjs',['init',root,options.theme??'weava',options.domain??'http://127.0.0.1:'+value.port]);
  if(options.template==='blank'){
    const custom=join(root,'custom');mkdirSync(join(custom,'src/pages'),{recursive:true});
    writeFileSync(join(custom,'src/pages/index.astro'),'---\nimport {getWebsite} from "@weava/site";\nconst website=getWebsite();\n---\n<html lang="zh-CN"><meta charset="utf-8"><title>{website.settings.name}</title><main><h1>{website.settings.name}</h1></main></html>\n');
    atomic(join(custom,'tsconfig.json'),{compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,paths:{'@weava/site':[join(p.root,'runtime/site-public.d.ts')]}}});
  }
  updateInstallation(home,value=>{if(value.sites[id])throw new Error('网站编号已在创建期间登记。');value.sites[id]={root,autostart:false};});writeLauncher(home,root);
  return {id,root,port:value.port,programId:p.manifest.id};
}
export function writeLauncher(home:string,root:string){
  const command=join(home,'weava.cmd').replaceAll('%','%%');
  writeFileSync(join(root,'start.bat'),'@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\ncall "'+command+'" --human --site "%~dp0." site start\r\nset "weavaExit=%ERRORLEVEL%"\r\npause\r\nexit /b %weavaExit%\r\n');
}
function files(root:string,base=root):string[]{
  if(!existsSync(root))return [];
  return readdirSync(root).flatMap(name=>{const path=join(root,name),s=lstatSync(path);if(s.isSymbolicLink())return [];return s.isDirectory()?files(path,base):[relative(base,path)];});
}
const mutableFiles=['weava.sqlite','analytics.sqlite','business.sqlite','site.json','program.json','cli-token','account.key','start.bat'];
export async function onlineWorkspace(home:string,root:string,p:Program,buildId?:string,buildHash?:string){
 const install=loadInstallation(home),id=json(join(root,'site.json')).id;
 const work=join(install.backupRoot,id,'preflight-'+randomUUID());mkdirSync(work,{recursive:true});
 assertSpace(work,mutableFiles.filter(n=>existsSync(join(root,n))).reduce((n,f)=>n+statSync(join(root,f)).size,0));
 for(const name of mutableFiles){const source=join(root,name);if(!existsSync(source))continue;
  if(name.endsWith('.sqlite')){const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,join(work,name));}finally{db.close();}}
  else copyFileSync(source,join(work,name));
 }
 for(const dir of ['extensions','themes','imports'])for(const rel of files(join(root,dir))){
  if(dir==='imports'&&!/\.(json|css|js|mjs)$/i.test(rel))continue;
  const source=join(root,dir,rel);if(statSync(source).size>16*1024*1024)throw new Error('预检资料超过小文件限制：'+rel);
  const target=join(work,dir,rel);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
 }
 const stamp=siteStamp(work);atomic(join(work,'program.json'),selection(home,p,buildId,buildHash));
 return {root:work,stamp};
}
export async function checkWorkspace(home:string,source:string,work:string,p:Program){
 return run(p,loadInstallation(home).node,'check.mjs',[work],{WEAVA_MAINTENANCE_ROOT:'',WEAVA_MAINTENANCE_TOKEN:'',WEAVA_SITE:work,WEAVA_DATABASE_MODE:'migrate',WEAVA_RESOURCE_ROOT:source,WEAVA_SITE_BUILDS_ROOT:join(source,'site-builds'),WEAVA_MANAGED_UPDATE:'1',WEAVA_EXTERNAL_RECOVERY:'1'});
}
export async function checkpoint(home:string,root:string){
  noDirectoryLink(root);const install=loadInstallation(home),id=existsSync(join(root,'site.json'))?json(join(root,'site.json')).id??'legacy':'new';
  const folder=join(install.backupRoot,id,'update-'+randomUUID());mkdirSync(folder,{recursive:true});
  assertSpace(folder,mutableFiles.filter(n=>existsSync(join(root,n))).reduce((n,f)=>n+statSync(join(root,f)).size,0)*2);
  const entries:{path:string;hash:string}[]=[];
  for(const name of mutableFiles){
    const source=join(root,name);if(!existsSync(source))continue;
    if(name.endsWith('.sqlite')){const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,join(folder,name));}finally{db.close();}}
    else copyFileSync(source,join(folder,name));
    entries.push({path:name,hash:hash(readFileSync(join(folder,name)))});
  }
  for(const name of files(join(root,'extensions')).map(p=>'extensions/'+p)){
    const source=join(root,name);if(statSync(source).size>32*1024*1024)throw new Error('扩展文件超过恢复点的小文件限制，请先检查：'+name);
    mkdirSync(dirname(join(folder,name)),{recursive:true});copyFileSync(source,join(folder,name));entries.push({path:name,hash:hash(readFileSync(join(folder,name)))});
  }
  atomic(join(folder,'recovery.json'),{version:1,kind:'migration-recovery',root:resolve(root),entries,absent:mutableFiles.filter(name=>!existsSync(join(root,name))),createdAt:new Date().toISOString()});
  return folder;
}
export function restoreCheckpoint(folder:string,root:string){ return recoverFiles(folder,root); }
export async function preflight(home:string,root:string,p:Program,point:string,buildId?:string,buildHash?:string){
  const install=loadInstallation(home),work=join(point,'check');mkdirSync(work,{recursive:true});
  for(const name of mutableFiles)if(existsSync(join(point,name)))copyFileSync(join(point,name),join(work,name));
  for(const dir of ['extensions','themes','imports']){
    const base=join(root,dir);
    for(const rel of files(base)){
      if(dir==='imports'&&!/\.(json|css|js|mjs)$/i.test(rel))continue;
      const source=join(base,rel);if(statSync(source).size>16*1024*1024)throw new Error('预检所需资料过大，请先缩小或适配读取入口：'+rel);
      const target=join(work,dir,rel);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
    }
  }
  atomic(join(work,'program.json'),selection(home,p,buildId,buildHash));
  return run(p,install.node,'check.mjs',[work],{WEAVA_MAINTENANCE_ROOT:'',WEAVA_MAINTENANCE_TOKEN:'',WEAVA_SITE:work,WEAVA_DATABASE_MODE:'migrate',WEAVA_RESOURCE_ROOT:root,WEAVA_SITE_BUILDS_ROOT:join(root,'site-builds'),WEAVA_MANAGED_UPDATE:'1',WEAVA_EXTERNAL_RECOVERY:'1'});
}
export async function migrate(home:string,root:string,p:Program,skipRender=false){
  const install=loadInstallation(home);
  return run(p,install.node,'check.mjs',[root],{WEAVA_SITE:root,WEAVA_DATABASE_MODE:'migrate',WEAVA_MANAGED_UPDATE:'1',WEAVA_EXTERNAL_RECOVERY:'1',WEAVA_SKIP_RENDER:skipRender?'1':'0'});
}
export interface OnlinePreparation{stamp:string;rehearsal:{migrationFiles?:string[]};work:string;operation:string}
export async function adoptSite(home:string,root:string,id:string,programId?:string,siteBuildId?:string,prepared?:OnlinePreparation){
  const install=loadInstallation(home),p=programFor(install,programId),before=inspect(root);
  if(!before.exists)throw new Error('站点尚未初始化，请使用 site create。');
  if(before.schemaVersion>p.manifest.schemaVersion)throw new Error('候选程序比站点数据库旧，不能接管。');
  const old=json(join(root,'site.json')),config=siteDescriptorSchema.parse({version:2,id,port:old.port??4322,features:old.features??allFeatures,template:old.template??(id==='demo'?'demo':'blank'),environment:old.environment,upgrade:old.upgrade});
  const prior=existsSync(join(root,'program.json'))?json(join(root,'program.json')):null;
  const buildId=siteBuildId??prior?.siteBuildId;
  let buildHash:string|undefined;
  if(buildId){
    if(!/^[\w-]+$/.test(buildId))throw new Error('网站构建编号无效。');
    const file=join(root,'site-builds',buildId,'site-build.json'),build=json(file);
    if(build.programId!==p.manifest.id)throw new Error('网站构建使用了其他程序版本，请执行 site build --program 目标编号 后再启用。');
    repairSiteBuildLink(root,buildId,p.root);
    buildHash=hash(readFileSync(file));
  }
  if(install.sites[id]&&canonical(install.sites[id].root)!==canonical(root))throw new Error('网站编号已被其他目录使用。');
  const runtime=existsSync(join(root,'runtime.json'))?json(join(root,'runtime.json')):null;
  if(runtime?.status!=='stopped'&&runtime?.pid){try{process.kill(runtime.pid,0);throw new Error('请先停止旧站点进程。');}catch(e:any){if(e.code!=='ESRCH')throw e;}}
  return withLease(home,root,p,async()=>{
  if(prepared&&siteStamp(root)!==prepared.stamp)throw new Error('准备期间网站数据已变化，已取消切换，请重新检查。');
  const journal=join(root,'.weava-update.json');
  if(existsSync(journal)&&!['complete','rolled-back'].includes(json(journal).status))throw new Error('上一次操作尚未完成，请先执行 site recover。');
  for(const oldJournal of [root+'.upgrade.json',root+'.restore.json'])if(existsSync(oldJournal)&&['prepared','validating','displaced'].includes(json(oldJournal).status))throw new Error('旧恢复操作尚未完成，请先恢复：'+oldJournal);
  const fingerprint=authoredFingerprint(root),point=await checkpoint(home,root);
  atomic(journal,{version:1,status:'prepared',root,point,programId:p.manifest.id,before,createdAt:new Date().toISOString(),online:prepared});
  try{
    const rehearsal=prepared?.rehearsal??await preflight(home,root,p,point,buildId,buildHash);
    const recovery=json(join(point,'recovery.json'));recovery.absent.push(...(rehearsal.migrationFiles??[]).filter((file:string)=>!existsSync(inside(root,file))));atomic(join(point,'recovery.json'),recovery);
    atomic(journal,{version:1,status:'migrating',root,point,programId:p.manifest.id,before,online:prepared});
    atomic(join(root,'program.json'),selection(home,p,buildId,buildHash));
    await migrate(home,root,p,!!prepared);atomic(join(root,'site.json'),config);
    const after=inspect(root);if(after.releaseId!==before.releaseId||JSON.stringify(authoredFingerprint(root,Object.keys(fingerprint.account)))!==JSON.stringify(fingerprint))throw new Error('迁入改变了已有内容、账户或公开版本。');
    updateInstallation(home,value=>{if(value.sites[id]&&canonical(value.sites[id].root)!==canonical(root))throw new Error('网站编号已在接管期间登记到其他目录。');value.sites[id]={...value.sites[id],root,autostart:value.sites[id]?.autostart??false};});writeLauncher(home,root);
    atomic(journal,{version:1,status:'selected',root,point,programId:p.manifest.id,before,online:prepared});
    return {id,root,point,before,after,programId:p.manifest.id};
  }catch(error){restoreCheckpoint(point,root);atomic(journal,{version:1,status:'rolled-back',root,point,error:String(error)});throw error;}
  });
}
export function checkFeatures(root:string,features:FeatureId[]){
  features=validateFeatures(features);const current=descriptor(root).features;
  const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});
  try{
    if(current.some(feature=>!features.includes(feature))&&Number(db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()?.n))throw new Error('网站仍有待执行或运行中的任务，请先处理任务后再停用功能。');
    if(current.includes('content')&&!features.includes('content')&&Number(db.prepare("SELECT COUNT(*) n FROM records WHERE scope='entry'").get()?.n))throw new Error('网站仍有内容，请先处理内容引用后再停用。');
    if(current.includes('media')&&!features.includes('media')&&Number(db.prepare("SELECT COUNT(*) n FROM records WHERE scope='media' OR scope IN ('entry','settings','layout') AND instr(data,'/media/')>0").get()?.n))throw new Error('网站仍有媒体或媒体引用，请先处理引用后再停用。');
  }finally{db.close();}
  return features;
}
export async function applyFeatures(home:string,root:string,program:Program,features:FeatureId[]){
  return withLease(home,root,program,async()=>{
    const before=descriptor(root),checked=checkFeatures(root,features);
    try{atomic(join(root,'site.json'),{...before,features:checked});await run(program,loadInstallation(home).node,'site-maintenance.mjs',['migrate',root]);}
    catch(error){atomic(join(root,'site.json'),before);throw error;}
    return checked;
  });
}

