import {existsSync,readdirSync,lstatSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {WeavaError} from '@weava/contracts';

/** Persistent site files, excluding rebuildable caches and registered dependency references. */
export function siteFiles(root:string) {
  const files:string[]=[];
  function visit(folder:string) {
    if(!existsSync(folder))return;
    for(const name of readdirSync(folder)){
      const path=join(folder,name),key=relative(root,path).replaceAll('\\','/');
      if(/^(?:custom\/\.astro|site-builds\/[^/]+\/cache)(?:\/|$)/.test(key))continue;
      const info=lstatSync(path);
      if(info.isSymbolicLink()){
        const match=/^site-builds\/([^/]+)\/node_modules$/.exec(key);
        if(match){
          const folder=join(root,'site-builds',match[1]),manifest=JSON.parse(readFileSync(join(folder,existsSync(join(folder,'site-build.json'))?'site-build.json':'build-state.json'),'utf8'));
          if(manifest.id===match[1]&&manifest.dependencyReference==='node_modules')continue;
        }
        throw new WeavaError('网站包含未登记的目录关联：'+key);
      }
      if(info.isDirectory())visit(path);else if(info.isFile())files.push(path);
    }
  }
  for(const name of ['media','themes','extensions','imports','logs','archives','custom','site-builds'])visit(join(root,name));
  for(const name of ['site.json','program.json','cli-token','account.key','start.bat'])if(existsSync(join(root,name)))files.push(join(root,name));
  return files;
}
