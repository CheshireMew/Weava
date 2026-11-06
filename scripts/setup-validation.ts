import {existsSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
export const validationToolsRoot=resolve(process.env.WEAVA_VALIDATION_TOOLS??'D:/Tools/weava-validation');
const source=join(import.meta.dirname,'validation');
export function prepareValidationTools(){
  const manifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const ready=Object.entries(manifest.dependencies).every(([name,version])=>{
    const file=join(validationToolsRoot,'node_modules',name,'package.json');
    return existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).version===version;
  });
  if(ready)return;
  if(existsSync(join(validationToolsRoot,'node_modules')))throw new Error('校验工具版本不匹配，请通过 WEAVA_VALIDATION_TOOLS 指定一个空目录；现有共享工具未改动。');
  mkdirSync(validationToolsRoot,{recursive:true});
  for(const name of ['package.json','package-lock.json'])copyFileSync(join(source,name),join(validationToolsRoot,name));
  const result=spawnSync(process.execPath,[join(process.execPath,'../node_modules/npm/bin/npm-cli.js'),'install','--prefix',validationToolsRoot,'--cache','D:/Tools/cache/weava/npm','--ignore-scripts','--no-audit','--no-fund'],{windowsHide:true,stdio:'inherit'});
  if(result.error||result.status!==0)throw result.error??new Error('校验工具安装失败。');
}
if(process.argv.includes('--install'))prepareValidationTools();
