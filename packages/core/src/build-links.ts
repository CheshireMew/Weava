import {existsSync,lstatSync,mkdirSync,renameSync,symlinkSync,realpathSync,readFileSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Repair a manifest-owned link only. Its previous target is never modified. */
export function repairSiteBuildLink(root:string,buildId:string,programRoot:string){
  if(!/^[\w-]+$/.test(buildId))throw new Error('网站构建编号无效。');
  const folder=join(root,'site-builds',buildId),manifest=JSON.parse(readFileSync(join(folder,'site-build.json'),'utf8'));
  if(manifest.dependencyReference!=='node_modules')throw new Error('网站构建没有登记依赖关联。');
  const reference=join(folder,'node_modules'),target=join(programRoot,'node_modules');let info;
  try{info=lstatSync(reference);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(info&&!info.isSymbolicLink())throw new Error('网站构建依赖位置被普通目录占用。');
  if(!existsSync(target))throw new Error('网站构建所需程序依赖不存在，请先准备所选程序。');
  if(info){
    try{if(realpathSync.native(reference).toLowerCase()===realpathSync.native(target).toLowerCase())return;}catch{}
    const retained=join(dirname(resolve(root)),'.weava-links-'+basename(root)+'-'+randomUUID());
    mkdirSync(retained,{recursive:true});renameSync(reference,join(retained,'node_modules'));
  }
  symlinkSync(target,reference,'junction');
}
