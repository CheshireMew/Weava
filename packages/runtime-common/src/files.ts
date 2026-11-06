import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { WeavaError } from '../../contracts/src/errors.ts';
import { uuid } from './identity.ts';

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const next = path + '.pending-' + uuid();
  writeFileSync(next, JSON.stringify(value, null, 2));
  renameSync(next, path);
}

export function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name),
      stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      const manifest = join(
        root,
        existsSync(join(root, 'site-build.json')) ? 'site-build.json' : 'build-state.json',
      );
      if (
        name === 'node_modules' &&
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, 'utf8')).dependencyReference === 'node_modules'
      )
        continue;
      throw new WeavaError('目录中存在链接，请使用普通目录：' + file);
    }
    if (stat.isDirectory()) result.push(...walk(file));
    else if (stat.isFile()) result.push(file);
  }
  return result;
}
