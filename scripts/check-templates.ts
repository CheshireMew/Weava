import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validationToolsRoot} from './setup-validation.ts';
export async function checkTemplates(){
  const entry=join(validationToolsRoot,'node_modules/@astrojs/check/dist/index.js');
  if(!existsSync(entry))throw new Error('请先运行 scripts/setup.ps1 准备 D 盘的 Astro 校验工具。');
  const {check}=await import(pathToFileURL(entry).href);
  return !await check({root:resolve('apps/web'),tsconfig:resolve('apps/web/tsconfig.json'),watch:false,minimumSeverity:'error',minimumFailingSeverity:'error'});
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))if(!await checkTemplates())process.exitCode=1;
