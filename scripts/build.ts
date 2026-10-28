import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, renameSync, copyFileSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { inside } from '../packages/core/src/storage.ts';
import { extensionManifestSchema } from '../packages/core/src/extension-manager.ts';
import { writeProgramManifest } from '../packages/core/src/programs.ts';
const root = resolve(import.meta.dirname, '..');
const output = process.env.WEAVA_BUILD_OUTPUT ? resolve(process.env.WEAVA_BUILD_OUTPUT) : null;
if(output&&existsSync(join(output,'program.json')))throw new Error('版本构建目录已存在，请选择新的输出目录。');
const adminOutput = output ? join(output, 'admin') : join(root, 'apps/admin/dist');
const runtimeOutput = output ? join(output, 'runtime') : join(root, 'dist');
for (const folder of [adminOutput, output ? join(output, 'web') : join(root, 'apps/web/dist'), runtimeOutput]) {
  if (existsSync(folder)) renameSync(folder, folder + '.retained-' + Date.now());
}
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
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', WEAVA_FRAMEWORK: root },
  },
);
if (result.status) process.exit(result.status);
const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  packages: 'external' as const,
  target: 'node24',
  alias: {
    '@weava/core': join(root, 'packages/core/src/index.ts'),
    '@weava/contracts': join(root, 'packages/contracts/src/index.ts'),
  },
};
await build({
  ...shared,
  entryPoints: [join(root, 'packages/core/src/worker.ts')],
  outfile: join(runtimeOutput, 'worker.mjs'),
});
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
if(output){if(!existsSync(join(output,'node_modules')))symlinkSync(join(root,'node_modules'),join(output,'node_modules'),'junction');writeProgramManifest(output,join(root,'node_modules'));}
console.log('Weava production build complete.');
