import { existsSync, lstatSync, mkdirSync, renameSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname,basename,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inside, json, canonical } from './state.ts';

export {repairSiteBuildLink} from '../../core/src/build-links.ts';

/** Rebuild only manifest-owned junctions. Never traverse or modify their old targets. */
export function repairProgramLinks(root:string,archiveRoot:string) {
  const manifest=json(join(root,'program.json'));
  if(!Array.isArray(manifest.dependencyLinks))throw new Error('程序没有登记依赖关联。');
  const members=manifest.dependencyLinks.map((item:any)=>{
    if(typeof item.path!=='string'||typeof item.target!=='string'||!item.path.startsWith('node_modules/')||!item.target.startsWith('node_modules/.store/'))throw new Error('依赖关联清单无效。');
    const file=inside(root,item.path),target=inside(root,item.target);
    if(!existsSync(target)||lstatSync(target).isSymbolicLink())throw new Error('程序内的真实依赖目录不存在：'+item.target);
    let info;try{info=lstatSync(file);}catch(e:any){if(e.code!=='ENOENT')throw e;}
    if(info&&!info.isSymbolicLink())throw new Error('依赖关联位置被普通文件占用：'+item.path);
    return {file,target,path:item.path,info};
  });
  let rebuilt=0;
  const retained=join(root,'.retained-links-'+randomUUID());
  for(const member of members){
    let correct=false;try{correct=canonical(member.file)===canonical(member.target);}catch{}
    if(correct)continue;
    if(member.info){const dest=inside(retained,member.path);mkdirSync(dirname(dest),{recursive:true});renameSync(member.file,dest);}
    mkdirSync(dirname(member.file),{recursive:true});symlinkSync(member.target,member.file,'junction');rebuilt++;
  }
  return {rebuilt,retained:rebuilt?retained:undefined};
}
