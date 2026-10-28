import Database from 'better-sqlite3';
import { join, resolve, relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { WeavaError, VERSION, API_VERSION } from '@weava/contracts';
import { inside, walk, digest, uuid, now, atomicJson, SCHEMA_VERSION } from './storage.ts';
import { assertOffline, verifyBackup } from './backup.ts';

interface ProgramManifest { version:1;id:string;framework:string;apiVersion:number;schemaVersion:number;nodeMajor:number;createdAt:string;dependencies:string;dependencyPackages:{name:string;hash:string}[];files:{path:string;hash:string}[] }
export function writeProgramManifest(output:string,dependencies:string) {
  const root=resolve(output), files=['admin','web','runtime'].flatMap((folder)=>walk(join(root,folder))).map((file)=>({path:relative(root,file).replaceAll('\\','/'),hash:digest(readFileSync(file))}));
  const pkg=JSON.parse(readFileSync(join(resolve(dependencies),'..','package.json'),'utf8'));
  const dependencyPackages=Object.keys({...pkg.dependencies,...pkg.devDependencies}).filter((name)=>!String(pkg.dependencies?.[name]??pkg.devDependencies?.[name]).startsWith('workspace:')).map((name)=>({name,hash:digest(readFileSync(join(dependencies,name,'package.json')))}));
  const manifest:ProgramManifest={version:1,id:uuid(),framework:VERSION,apiVersion:API_VERSION,schemaVersion:SCHEMA_VERSION,nodeMajor:24,createdAt:now(),dependencies:resolve(dependencies),dependencyPackages,files};atomicJson(join(root,'program.json'),manifest);return manifest;
}
export function verifyProgram(input:string) {
  const root=resolve(input), manifest=JSON.parse(readFileSync(join(root,'program.json'),'utf8')) as ProgramManifest;
  if(manifest.version!==1||manifest.apiVersion!==API_VERSION||!Number.isSafeInteger(manifest.schemaVersion)||manifest.nodeMajor!==Number(process.versions.node.split('.')[0])||!Array.isArray(manifest.files)||!manifest.files.length)throw new WeavaError('程序清单或 Node/API 版本不兼容。');
  for(const file of manifest.files){if(!file.path||!file.path.startsWith('admin/')&&!file.path.startsWith('web/')&&!file.path.startsWith('runtime/'))throw new WeavaError('程序清单包含非程序文件。');if(digest(readFileSync(inside(root,file.path)))!==file.hash)throw new WeavaError('程序文件校验失败：'+file.path);}
  for(const required of ['runtime/weava.mjs','runtime/worker.mjs','runtime/check.mjs','web/server/entry.mjs','admin/index.html'])if(!manifest.files.some((file)=>file.path===required))throw new WeavaError('程序缺少入口：'+required);
  if(!existsSync(join(root,'node_modules','better-sqlite3','package.json')))throw new WeavaError('程序依赖未就绪，请在构建时配置 Node 依赖目录。');
  for(const dependency of manifest.dependencyPackages??[]){if(digest(readFileSync(join(root,'node_modules',dependency.name,'package.json')))!==dependency.hash)throw new WeavaError('程序依赖版本发生变化：'+dependency.name+'，请重新构建与检查。');}
  return {root,manifest,manifestHash:digest(readFileSync(join(root,'program.json')))};
}
function instanceFingerprint(root:string) {
  const databaseHash=(file:string)=>{const db=new Database(file,{readonly:true});try{const hash=createHash('sha256');const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];hash.update(JSON.stringify(schema));for(const table of schema){for(const row of db.prepare('SELECT * FROM "'+table.name.replaceAll('"','""')+'"').iterate())hash.update(JSON.stringify(row));}return hash.digest('hex');}finally{db.close();}};
  return digest(walk(root).filter((file)=>!['weava.sqlite-shm','analytics.sqlite-shm','weava.sqlite-wal','analytics.sqlite-wal'].includes(relative(root,file))).map((file)=>[relative(root,file).replaceAll('\\','/'),/^(weava|analytics)\.sqlite$/.test(relative(root,file))?databaseHash(file):digest(readFileSync(file))]));
}
export function selectedProgram(siteRoot:string) {
  const path=join(siteRoot,'program.json');if(!existsSync(path))return null;
  const pointer=JSON.parse(readFileSync(path,'utf8')), program=verifyProgram(pointer.root);
  if(program.manifestHash!==pointer.manifestHash)throw new WeavaError('已选择的程序清单发生变化，请重新检查升级。');return {...program,pointer};
}
async function snapshot(root:string,base:string) {
  const normalized=resolve(base).toLowerCase(),targetRoot=resolve(root).toLowerCase();if(normalized===targetRoot||normalized.startsWith(targetRoot+'\\')||normalized.startsWith(targetRoot+'/'))throw new WeavaError('升级备份目录必须在站点外。');
  const folder=join(resolve(base),'upgrade-before-'+uuid());mkdirSync(folder,{recursive:true});
  for(const name of ['weava.sqlite','analytics.sqlite'])if(existsSync(join(root,name))){const db=new Database(join(root,name),{readonly:true});try{await db.backup(join(folder,name));}finally{db.close();}}
  for(const file of walk(root)){const name=relative(root,file);if(/^(weava|analytics)\.sqlite(?:-(?:wal|shm))?$/.test(name))continue;const target=join(folder,name);mkdirSync(resolve(target,'..'),{recursive:true});copyFileSync(file,target);}
  const files=walk(folder).map((file)=>({path:relative(folder,file).replaceAll('\\','/'),hash:digest(readFileSync(file))}));atomicJson(join(folder,'manifest.json'),{version:1,id:uuid(),framework:VERSION,createdAt:now(),label:'程序升级前备份',files});verifyBackup(folder);return folder;
}
function copySnapshot(backup:string,target:string) {
  verifyBackup(backup);mkdirSync(target,{recursive:true});for(const file of walk(backup)){const name=relative(backup,file);if(name==='manifest.json')continue;const destination=join(target,name);mkdirSync(resolve(destination,'..'),{recursive:true});copyFileSync(file,destination);}
}
async function probe(program:string,root:string) {
  return new Promise<any>((resolve,reject)=>{const child=spawn(process.execPath,[join(program,'runtime/check.mjs'),root],{cwd:program,windowsHide:true,env:{...process.env,WEAVA_SITE:root,WEAVA_PROGRAM_ROOT:program},stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},60000);child.stdout.on('data',(data)=>{stdout+=data;if(stdout.length>1000000)child.kill();});child.stderr.on('data',(data)=>stderr+=data);child.once('error',(error)=>{clearTimeout(timer);reject(error);});child.once('close',(code)=>{clearTimeout(timer);if(timedOut){reject(new WeavaError('候选程序检查超时，原程序仍然保留。'));return;}if(code!==0){reject(new WeavaError('候选程序检查失败：'+(stdout||stderr).slice(-6000)));return;}try{resolve(JSON.parse(stdout));}catch{reject(new WeavaError('候选程序未返回有效检查结果。'));}});});
}
export interface UpgradePlan {version:1;id:string;target:string;programRoot:string;manifestHash:string;fingerprint:string;backup:string;checkedAt:string;probe:any}
export async function checkProgramUpgrade(siteRoot:string,programRoot:string,backupBase='D:/Tools/weava/backups') {
  const target=resolve(siteRoot);assertOffline(target);const program=verifyProgram(programRoot);
  if(existsSync(journalPath(target))&&['prepared','validating'].includes(JSON.parse(readFileSync(journalPath(target),'utf8')).status))throw new WeavaError('上一次升级尚未完成，请先运行 upgrade recover。',409);
  const db=new Database(join(target,'weava.sqlite'),{readonly:true});try{const current=(db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as any).v;if(current>program.manifest.schemaVersion)throw new WeavaError('候选程序的数据版本比站点旧，不能直接切换。');if(db.pragma('integrity_check',{simple:true})!=='ok')throw new WeavaError('站点数据库完整性检查失败。');}finally{db.close();}
  const fingerprint=instanceFingerprint(target),backup=await snapshot(target,backupBase),testRoot=join(resolve(backupBase),'upgrade-check-'+uuid());copySnapshot(backup,testRoot);
  const checked=await probe(program.root,testRoot);if(checked?.ok!==true)throw new WeavaError('候选程序未通过检查。');if(instanceFingerprint(target)!==fingerprint)throw new WeavaError('检查期间站点资料已变化，请重新检查。',409);
  const plan:UpgradePlan={version:1,id:uuid(),target,programRoot:program.root,manifestHash:program.manifestHash,fingerprint,backup,checkedAt:now(),probe:checked};
  const path=join(resolve(backupBase),'upgrade-plan-'+plan.id+'.json');atomicJson(path,plan);return {...plan,path};
}
const journalPath=(root:string)=>root+'.upgrade.json';
interface UpgradeJournal {version:1;target:string;plan:UpgradePlan;status:'prepared'|'validating'|'complete'|'rolled-back';retained?:string;completedAt?:string}
export async function applyProgramUpgrade(input:UpgradePlan) {
  const plan=input,target=resolve(plan.target);if(plan.version!==1||target!==plan.target)throw new WeavaError('升级计划无效。');assertOffline(target);
  const program=verifyProgram(plan.programRoot);if(program.manifestHash!==plan.manifestHash||instanceFingerprint(target)!==plan.fingerprint)throw new WeavaError('程序或站点资料已变化，请重新检查升级。',409);verifyBackup(plan.backup);
  const journal:UpgradeJournal={version:1,target,plan,status:'prepared'};atomicJson(journalPath(target),journal);
  try{
    atomicJson(journalPath(target),{...journal,status:'validating'});const checked=await probe(program.root,target);if(checked?.ok!==true)throw new WeavaError('候选程序未通过检查。');
    const previous=existsSync(join(target,'program.json'))?JSON.parse(readFileSync(join(target,'program.json'),'utf8')):null;
    atomicJson(join(target,'program.json'),{version:1,root:program.root,manifestHash:program.manifestHash,id:program.manifest.id,framework:program.manifest.framework,previous,upgradePlanId:plan.id});
    atomicJson(journalPath(target),{...journal,status:'complete',completedAt:now()});return {applied:true,program:program.manifest.id,root:program.root,backup:plan.backup,journal:journalPath(target)};
  }catch(error){recoverProgramUpgrade(target);throw error;}
}
export function recoverProgramUpgrade(siteRoot:string,force=false) {
  const target=resolve(siteRoot),path=journalPath(target);if(!existsSync(path))return {recovered:false};const journal=JSON.parse(readFileSync(path,'utf8')) as UpgradeJournal;
  if(journal.version!==1||journal.target!==target||journal.plan.target!==target)throw new WeavaError('升级恢复日志无效。');if(journal.status==='rolled-back'||journal.status==='complete'&&!force)return {recovered:false,status:journal.status};assertOffline(target);
  const restored=target+'.upgrade-restore-'+uuid(),retained=target+'.upgrade-retained-'+uuid();copySnapshot(journal.plan.backup,restored);
  if(existsSync(target))renameSync(target,retained);try{renameSync(restored,target);}catch(error){if(existsSync(retained)&&!existsSync(target))renameSync(retained,target);throw error;}
  atomicJson(path,{...journal,status:'rolled-back',retained,completedAt:now()});return {recovered:true,target,retained,restoredBackup:journal.plan.backup};
}
export function programStatus(siteRoot:string){const root=resolve(siteRoot),path=join(root,'program.json');if(!existsSync(path))return {selected:false,framework:VERSION};const pointer=JSON.parse(readFileSync(path,'utf8'));return {selected:true,id:pointer.id,framework:pointer.framework,root:pointer.root,upgradePlanId:pointer.upgradePlanId};}
