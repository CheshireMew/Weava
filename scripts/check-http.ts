import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,lstatSync,readFileSync,mkdirSync,writeFileSync,symlinkSync,realpathSync,statfsSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';

const framework=resolve(import.meta.dirname,'..');
const base=resolve(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/architecture-repair-20261106');
function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{const path=join(root,entry.name);if(entry.isSymbolicLink())return [];return entry.isDirectory()?files(path):[path];});}
function hash(paths:string[]){const sum=createHash('sha256');for(const path of [...paths].sort())sum.update(relative(framework,path)).update(readFileSync(path));return sum.digest('hex');}
const fingerprint=hash(['apps/web/src','apps/web/public','packages/core/src','packages/contracts/src'].flatMap(dir=>files(join(framework,dir))).concat(['apps/web/astro.config.mjs','package.json','pnpm-lock.yaml'].map(file=>join(framework,file))));
const output=join(base,'web-'+fingerprint.slice(0,20)),entry=join(output,'web/server/entry.mjs'),manifest=join(output,'http-build.json');
mkdirSync(base,{recursive:true});
const disk=statfsSync(base);if(disk.bavail*disk.bsize<512*1024*1024)throw new Error('HTTP 校验工作目录空间不足，未新增编译产物。');
async function run(args:string[],cwd:string,env:NodeJS.ProcessEnv){
  return new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('HTTP 校验命令失败，退出码：'+code)));});
}
const env={...process.env,ASTRO_TELEMETRY_DISABLED:'1'};
let reusable=false;
if(existsSync(manifest)&&existsSync(entry)){
  const saved=JSON.parse(readFileSync(manifest,'utf8'));reusable=saved.fingerprint===fingerprint&&saved.outputHash===hash(files(join(output,'web')));
}
if(!reusable){
  // This compiles only the HTTP test server. It does not create/select a release,
  // freeze dependencies, build the admin, or touch installed websites.
  if(existsSync(join(output,'web')))throw new Error('HTTP 校验编译目录不完整，请保留现场并指定新的 WEAVA_TEST_OUTPUT；没有覆盖或删除已有产物。');
  mkdirSync(output,{recursive:true});
  await run([join(framework,'node_modules/astro/bin/astro.mjs'),'build'],join(framework,'apps/web'),{...env,WEAVA_FRAMEWORK:framework,WEAVA_BUILD_OUTPUT:output,WEAVA_BUILD_CACHE:join(output,'cache')});
  if(!existsSync(entry))throw new Error('HTTP 校验缺少编译服务入口，不能跳过测试。');
  writeFileSync(manifest,JSON.stringify({fingerprint,outputHash:hash(files(join(output,'web')))},null,2));
}
const link=join(output,'node_modules'),target=join(framework,'node_modules');
if(!existsSync(link))symlinkSync(target,link,'junction');
else if(!lstatSync(link).isSymbolicLink()||realpathSync.native(link).toLowerCase()!==realpathSync.native(target).toLowerCase())throw new Error('HTTP 校验依赖关联与当前工作区不一致。');
const recoveryOnly=process.argv.includes('--recovery');
const targets=recoveryOnly
  ? ['tests/recovery-boundaries.test.ts','--testNamePattern=recovery through the current HTTP server']
  : ['tests/http-lifecycle.test.ts','tests/recovery-boundaries.test.ts'];
await run([join(framework,'node_modules/vitest/vitest.mjs'),'list',...targets,'--no-static-parse','--json='+join(base,'http-collected.json')],framework,{...env,WEAVA_TEST_WEB_ENTRY:entry,WEAVA_REQUIRE_HTTP_TESTS:'1',WEAVA_REQUIRE_RECOVERY_HTTP:'1',WEAVA_TEST_OUTPUT:join(base,'http-cases')});
await run([join(framework,'node_modules/vitest/vitest.mjs'),'run',...targets,'--reporter=default','--reporter=json','--outputFile.json='+join(base,'http-results.json')],framework,{...env,WEAVA_TEST_WEB_ENTRY:entry,WEAVA_REQUIRE_HTTP_TESTS:'1',WEAVA_REQUIRE_RECOVERY_HTTP:'1',WEAVA_TEST_OUTPUT:join(base,'http-cases')});
