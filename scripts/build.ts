import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, renameSync, copyFileSync, writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '..');
for (const name of ['apps/web/dist', 'apps/admin/dist', 'dist']) {
  const folder = join(root, name);
  if (existsSync(folder)) renameSync(folder, folder + '.retained-' + Date.now());
}
await viteBuild({
  root: join(root, 'apps/admin'),
  configFile: join(root, 'apps/admin/vite.config.ts'),
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
  outfile: join(root, 'dist/worker.mjs'),
});
await build({
  ...shared,
  entryPoints: [join(root, 'packages/cli/src/index.ts')],
  outfile: join(root, 'dist/weava.mjs'),
});
const siteRoot = process.env.WEAVA_SITE;
if (siteRoot && existsSync(join(siteRoot, 'extensions/index.ts')))
  await build({
    entryPoints: [join(siteRoot, 'extensions/index.ts')],
    outfile: join(siteRoot, 'extensions/index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    nodePaths: [join(root, 'node_modules')],
    banner: {
      js: 'import {createRequire as _createRequire} from "node:module"; const require=_createRequire(import.meta.url);',
    },
  });
console.log('Weava production build complete.');
