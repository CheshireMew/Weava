import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { WeavaError } from '../../contracts/src/errors.ts';

export function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'))
  );
}

export function inside(root: string, input: string): string {
  const path = resolve(root, input);
  if (!within(root, path)) throw new WeavaError('路径超出站点目录。');
  return path;
}

/** Resolve existing ancestors without requiring a destination to exist yet. */
export function canonicalPath(input: string): string {
  let path = resolve(input);
  const suffix: string[] = [];
  while (!existsSync(path) && dirname(path) !== path) {
    suffix.unshift(basename(path));
    path = dirname(path);
  }
  path = join(realpathSync.native(path), ...suffix);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function pathWithin(root: string, path: string): boolean {
  return within(canonicalPath(root), canonicalPath(path));
}
