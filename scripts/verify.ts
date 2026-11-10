import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
export const architectureTests=[
  'query-rules','runtime-common','cli-commands','api-contracts',
  'architecture-boundaries','architecture-repairs','admin-cache-invalidation','admin-query-cache','admin-error-recovery','admin-navigation-performance',
  'notes-ui','draft-repository','local-drafts','entry-autosave','edit-session','settings-application','seo-upgrade','job-runner','core','shared-runtime','revisions','managed-recovery','comments-edit-session','publication-scheduler','media-manager',
  'temporary-lifecycle','upgrade-activation','upload-identity','functional-completion','functional-storage','public-locale',
].map(name=>'tests/'+name+'.test.'+(['admin-query-cache','admin-error-recovery','admin-navigation-performance','notes-ui','entry-autosave','comments-edit-session','media-manager'].includes(name)?'tsx':'ts'));
async function run(args:string[]){await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:process.cwd(),windowsHide:true,stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('验证失败，退出码：'+code)));});}
if(!process.argv.includes('--unit'))await run(['--import','tsx',resolve('scripts/check.ts')]);
await run([resolve('node_modules/vitest/vitest.mjs'),'run',...architectureTests]);
if(!process.argv.includes('--unit'))await run(['--import','tsx',resolve('scripts/check-http.ts')]);
