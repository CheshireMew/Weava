import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extension } from '../../core/src/extensions.ts';
import type { Site } from '../../core/src/site.ts';
import { installCryptoSource } from './crypto-source.ts';
export async function installCryptoExtension(site: Site, target: string) {
  const framework = process.env.WEAVA_FRAMEWORK ?? resolve(import.meta.dirname, '../../..');
  const source = join(framework, 'packages/crypto-extension/src');
  const extensionSource = existsSync(join(source, 'legacy.ts')) ? source : join(framework, 'runtime/crypto-assets');
  const extensionTarget = join(target, 'extensions/index.ts');
  if (!existsSync(extensionTarget)) installCryptoSource(extensionSource, join(target, 'extensions'), 'legacy');
  await build({
    entryPoints: [extensionTarget],
    outfile: join(target, 'extensions/index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    nodePaths: [join(framework, 'node_modules')],
    banner: {
      js: 'import { createRequire as _createRequire } from "node:module"; const require = _createRequire(import.meta.url);',
    },
  });
  await extension(site, {}, { mode: 'worker' });
}
