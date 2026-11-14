import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';

/** A v1 journal must never replace a managed site's v2 selection or recovery state. */
export function assertLegacyUpgrade(root: string) {
  for (const name of ['program.json', 'site.json']) {
    const file = join(root, name);
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).version === 2)
      throw new WeavaError(
        '这个站点使用托管格式，请使用 site update --check、site update 或 site recover；旧 upgrade 命令仅用于尚未接管的旧站点。',
        409,
      );
  }
}
