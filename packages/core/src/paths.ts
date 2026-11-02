import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { WeavaError } from '@weava/contracts';

/** Resolve existing ancestors as well as a not-yet-created destination. */
export function canonicalPath(input: string) {
  let path = resolve(input);
  const suffix: string[] = [];
  while (!existsSync(path) && dirname(path) !== path) { suffix.unshift(basename(path)); path = dirname(path); }
  path = join(realpathSync.native(path), ...suffix);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}
export function pathWithin(root: string, input: string) {
  const rel = relative(canonicalPath(root), canonicalPath(input));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'));
}
/** URLs and stored references share one identity before either authorization or I/O. */
export function mediaIdentity(input: string) {
  let path: string;
  try { path = decodeURIComponent(input); } catch { throw new WeavaError('媒体地址编码无效。', 404); }
  if (!/^\/media\//i.test(path) || path.includes('\\') || /[\x00-\x1f:*?"<>|]/.test(path) ||
    path.slice(7).split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part)))
    throw new WeavaError('媒体地址无效。', 404);
  if (process.platform === 'win32') path = path.toLowerCase();
  return '/media/' + path.slice(7).split('/').map(encodeURIComponent).join('/');
}
export function mediaFile(root: string, identity: string) {
  const base = join(root, 'media'), file = join(root, decodeURIComponent(identity.slice(1)));
  const expected = resolve(canonicalPath(base),decodeURIComponent(identity.slice(7)));
  const actual = canonicalPath(file);
  // Reject alternate filesystem names too, including internal junctions and NTFS short names.
  if (!pathWithin(base, file) || actual !== (process.platform === 'win32' ? expected.toLowerCase() : expected)) throw new WeavaError('媒体地址不是文件的规范路径。', 404);
  return file;
}

export function normalizePath(input: string) {
  let path = decodeURI(input.split(/[?#]/)[0]).replace(/\/+/g, '/');
  if (path.includes('..') || path.includes('\\') || !path.startsWith('/'))
    throw new WeavaError('网址路径无效。');
  if (path !== '/' && !/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/')) path += '/';
  return path;
}
