import { build } from 'esbuild';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extension } from '../../core/src/extensions.ts';
import type { Site } from '../../core/src/site.ts';
export async function installCryptoExtension(site: Site, target: string) {
  const framework = process.env.WEAVA_FRAMEWORK ?? resolve(import.meta.dirname, '../../..');
  const sourceTemplate = join(framework, 'scripts/crypto-extension.ts');
  const extensionTemplate = existsSync(sourceTemplate)?sourceTemplate:join(framework,'runtime/crypto-assets/legacy.ts');
  const extensionTarget = join(target, 'extensions/index.ts');
  if (!existsSync(extensionTarget)) copyFileSync(extensionTemplate, extensionTarget);
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
