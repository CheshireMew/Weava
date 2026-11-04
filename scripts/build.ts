import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
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
const siteRoot = process.env.WEAVA_SITE;
if (siteRoot) {
  const folder = join(siteRoot, 'extensions'), manifest = join(folder, 'manifest.json');
  const outputs = existsSync(manifest) ? extensionManifestSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))).extensions.map((item) => inside(folder, item.file)) : [join(folder, 'index.mjs')];
  for (const outfile of outputs) {
    const source = outfile.replace(/\.mjs$/, '.ts');
    if (!existsSync(source)) { if (existsSync(manifest) && !existsSync(outfile)) throw new Error('扩展源码或编译结果不存在：' + source); continue; }
    await build({
    entryPoints: [source],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    nodePaths: [join(root, 'node_modules')],
    banner: {
      js: 'import {createRequire as _createRequire} from "node:module"; const require=_createRequire(import.meta.url);',
    },
  });
  }
}
writeProgramManifest(output,join(root,'node_modules'));
verifyProgram(output);
// The CLI also exposes offline migration commands. Their imports must resolve
// from frozen dependencies before the program is eligible for selection.
const smoke=spawnSync(process.execPath,[join(runtimeOutput,'weava.mjs'),'--help'],{cwd:output,windowsHide:true,encoding:'utf8',env:{...process.env,WEAVA_FRAMEWORK:root}});
if(smoke.error)throw smoke.error;
if(smoke.status!==0)throw new Error('独立 CLI 启动检查失败：'+smoke.stderr);
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
