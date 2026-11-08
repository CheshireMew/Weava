import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { inside, uuid } from '../packages/core/src/storage.ts';
import { extensionManifestSchema } from '../packages/core/src/extension-manager.ts';
import { writeProgramManifest, verifyProgram, selectDefaultProgram } from '../packages/core/src/programs.ts';
const root = resolve(import.meta.dirname, '..');
const selectDefault = !process.env.WEAVA_BUILD_OUTPUT;
const output = process.env.WEAVA_BUILD_OUTPUT ? resolve(process.env.WEAVA_BUILD_OUTPUT) : join('D:/Tools/cache/weava/programs','build-'+Date.now()+'-'+uuid());
if(existsSync(join(output,'program.json')))throw new Error('版本构建目录已存在，请选择新的输出目录。');
const adminOutput = join(output,'admin'),runtimeOutput = join(output,'runtime');
// All compilation happens outside the selected program. Failed work is retained.
await viteBuild({
  root: join(root, 'apps/admin'),
  configFile: join(root, 'apps/admin/vite.config.ts'),
  build: { outDir: adminOutput, emptyOutDir: false },
});
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'],
  {
    cwd: join(root, 'apps/web'),
    stdio: 'inherit',
    env: { ...process.env, WEAVA_BUILD_OUTPUT:output, ASTRO_TELEMETRY_DISABLED: '1', WEAVA_FRAMEWORK: root },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  packages: 'external' as const,
  target: 'node24',
  alias: {
    '@weava/contracts/api-error': join(root, 'packages/contracts/src/api-error.ts'),
    '@weava/contracts/session-api': join(root, 'packages/contracts/src/session-api.ts'),
    '@weava/contracts/api-client': join(root, 'packages/contracts/src/api-client.ts'),
    '@weava/contracts/api': join(root, 'packages/contracts/src/admin-api.ts'),
    '@weava/core': join(root, 'packages/core/src/index.ts'),
    '@weava/contracts': join(root, 'packages/contracts/src/index.ts'),
  },
};
await build({
  ...shared,
  entryPoints: [join(root, 'packages/core/src/worker.ts')],
  outfile: join(runtimeOutput, 'worker.mjs'),
});
await build({...shared,entryPoints:[join(root,'packages/core/src/query-worker.ts')],outdir:runtimeOutput,splitting:true,outExtension:{'.js':'.mjs'}});
await build({
  ...shared,
  entryPoints: [join(root, 'packages/cli/src/index.ts')],
  outfile: join(runtimeOutput, 'weava.mjs'),
});
await build({...shared,entryPoints:[join(root,'packages/core/src/program-check.ts')],outfile:join(runtimeOutput,'check.mjs')});
await build({...shared,entryPoints:[join(root,'packages/core/src/site-maintenance.ts')],outfile:join(runtimeOutput,'site-maintenance.mjs')});
await build({...shared,entryPoints:[join(root,'packages/core/src/site-public.ts')],outfile:join(runtimeOutput,'site-public.mjs')});
await build({...shared,packages:undefined,banner:{js:'import {createRequire as _cryptoRequire} from "node:module";const require=_cryptoRequire(import.meta.url);'},entryPoints:[join(root,'packages/crypto-extension/src/index.ts')],outfile:join(runtimeOutput,'crypto-extension.mjs')});
mkdirSync(join(runtimeOutput,'crypto-assets'),{recursive:true});
for(const file of ['browser.js','announcements.js'])copyFileSync(join(root,'packages/crypto-extension/src',file),join(runtimeOutput,'crypto-assets',file));
copyFileSync(join(root,'packages/crypto-extension/src/index.ts'),join(runtimeOutput,'crypto-assets/index.ts'));
copyFileSync(join(root,'scripts/crypto-extension.ts'),join(runtimeOutput,'crypto-assets/legacy.ts'));
await build({...shared,entryPoints:[join(root,'packages/site-runtime/src/build.ts')],outfile:join(runtimeOutput,'site-build.mjs')});
await build({...shared,entryPoints:[join(root,'packages/site-runtime/src/entry.ts')],outfile:join(runtimeOutput,'site-entry.mjs')});
await build({...shared,packages:undefined,banner:{js:'import {createRequire as _managerRequire} from "node:module";const require=_managerRequire(import.meta.url);'},entryPoints:[join(root,'packages/manager/src/index.ts')],outfile:join(runtimeOutput,'manager.mjs')});
copyFileSync(join(root,'packages/site-runtime/src/sdk.d.ts'),join(runtimeOutput,'site-public.d.ts'));
writeProgramManifest(output,join(root,'node_modules'));
verifyProgram(output);
// The CLI also exposes offline migration commands. Their imports must resolve
// from frozen dependencies before the program is eligible for selection.
const smoke=spawnSync(process.execPath,[join(runtimeOutput,'weava.mjs'),'--help'],{cwd:output,windowsHide:true,encoding:'utf8',env:{...process.env,WEAVA_FRAMEWORK:root}});
if(smoke.error)throw smoke.error;
if(smoke.status!==0)throw new Error('独立 CLI 启动检查失败：'+smoke.stderr);

const managerSmoke=spawnSync(process.execPath,[join(runtimeOutput,'manager.mjs'),'--help'],{cwd:output,windowsHide:true,encoding:'utf8'});
if(managerSmoke.error||managerSmoke.status!==0)throw new Error('独立管理入口启动检查失败：'+(managerSmoke.error?.message??managerSmoke.stderr));
if(selectDefault){
  mkdirSync(join(root,'dist'),{recursive:true});
  selectDefaultProgram(root,output);
  // Legacy command paths are stable launchers. They read the same single selection.
  const launcher=(entry:string)=>`import{readFileSync}from'node:fs';import{join}from'node:path';import{pathToFileURL}from'node:url';const framework=${JSON.stringify(root)};const selected=JSON.parse(readFileSync(join(framework,'dist/current.json'),'utf8'));process.env.WEAVA_FRAMEWORK??=framework;process.env.WEAVA_ADMIN_DIST=join(selected.root,'admin');process.env.WEAVA_WORKER=join(selected.root,'runtime/worker.mjs');process.env.WEAVA_SOURCE_WORKER='0';await import(pathToFileURL(join(selected.root,${JSON.stringify(entry)})).href);`;
  mkdirSync(join(root,'apps/web/dist/server'),{recursive:true});
  for(const [file,entry]of [[join(root,'dist/weava.mjs'),'runtime/weava.mjs'],[join(root,'dist/worker.mjs'),'runtime/worker.mjs'],[join(root,'apps/web/dist/server/entry.mjs'),'web/server/entry.mjs']]){
    const source=launcher(entry);if(existsSync(file)&&readFileSync(file,'utf8')===source)continue;
    const next=file+'.pending-'+uuid();writeFileSync(next,source);renameSync(next,file);
  }
}
console.log('Weava production build complete.');
