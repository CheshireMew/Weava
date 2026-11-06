import {existsSync,readFileSync,lstatSync,statSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';

import {DatabaseSync} from 'node:sqlite';
import {installationSchema,siteDescriptorSchema,deploymentSchema,type Installation,type Deployment,type SiteDescriptor} from '../../contracts/src/installation.ts';
import {verifyProgram} from '../../runtime-common/src/program-manifest.ts';
export {digest as hash} from '../../runtime-common/src/identity.ts';
import {digest as hash} from '../../runtime-common/src/identity.ts';
export {atomicJson as atomic} from '../../runtime-common/src/files.ts';
import {atomicJson as atomic} from '../../runtime-common/src/files.ts';
export {inside,within,canonicalPath as canonical} from '../../runtime-common/src/paths.ts';
export function json<T=any>(path:string):T{return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));}
export function installationRoot(explicit?:string){
  return resolve(explicit??process.env.WEAVA_INSTALLATION??(basename(import.meta.dirname)==='manager'?join(import.meta.dirname,'..'):join(import.meta.dirname,'../../..')));
}
export function loadInstallation(root:string):Installation{return installationSchema.parse(json(join(root,'installation.json')));}
export function saveInstallation(root:string,value:Installation){atomic(join(root,'installation.json'),installationSchema.parse(value));}
export function updateInstallation(root:string,edit:(value:Installation)=>void){
  const lock=new DatabaseSync(join(root,'installation.access.sqlite'));
  lock.exec('PRAGMA busy_timeout=15000; BEGIN IMMEDIATE');
  try{const value=loadInstallation(root);edit(value);saveInstallation(root,value);lock.exec('COMMIT');return value;}
  catch(error){lock.exec('ROLLBACK');throw error;}finally{lock.close();}
}
export interface Program {root:string;manifest:any;manifestHash:string}
function programMetadata(root:string):Program{
  root=resolve(root);const source=readFileSync(join(root,'program.json'));
  return {root,manifest:JSON.parse(source.toString('utf8').replace(/^\uFEFF/,'')),manifestHash:hash(source)};
}
export function verify(root:string):Program {return verifyProgram(root,{managed:true});}
export function programFor(installation:Installation,id?:string,verifyFiles=true):Program{
  const key=id??installation.defaultProgramId,record=key?installation.programs[key]:undefined;
  if(!record)throw new Error('程序尚未登记，请先执行 program add。');
  const program=verifyFiles?verify(record.root):programMetadata(record.root);if(program.manifest.id!==key||program.manifestHash!==record.manifestHash)throw new Error('已登记程序发生变化。');return program;
}
export function siteRoot(installation:Installation,selector:string){
  const found=installation.sites[selector];if(found)return found.root;
  const root=resolve(selector);if(!existsSync(join(root,'site.json')))throw new Error('网站未登记或目录不存在：'+selector);return root;
}
export function descriptor(root:string):SiteDescriptor{return siteDescriptorSchema.parse(json(join(root,'site.json')));}
export function deployment(root:string):Deployment{return deploymentSchema.parse(json(join(root,'program.json')));}
export function selected(installation:Installation,root:string,verifyFiles=true){const d=deployment(root),p=programFor(installation,d.programId,verifyFiles);if(d.manifestHash!==p.manifestHash)throw new Error('网站所选程序清单发生变化。');return p;}
export function inspect(root:string){
  const file=join(root,'weava.sqlite');if(!existsSync(file))return {exists:false,schemaVersion:0,releaseId:null,entries:[]};
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const has=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
    const schemaVersion=has('schema_migrations')?Number(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()?.v??0):0;
    const state=has('state')?db.prepare("SELECT key,value FROM state WHERE key IN ('release','owner-profile')").all():[];
    const entries=has('records')?db.prepare("SELECT scope,COUNT(*) count FROM records GROUP BY scope").all():[];
    return {exists:true,schemaVersion,releaseId:state.find(r=>r.key==='release')?.value??null,entries};
  }finally{db.close();}
}
export function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}
export function bytes(paths:string[]){return paths.filter(existsSync).reduce((n,p)=>n+statSync(p).size,0);}
export function noDirectoryLink(path:string){let p=resolve(path);while(existsSync(p)){if(lstatSync(p).isSymbolicLink())throw new Error('操作目录不能经过目录链接：'+p);const parent=dirname(p);if(parent===p)break;p=parent;}}

