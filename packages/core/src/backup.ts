import { join, relative, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  renameSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import Database from 'better-sqlite3';
import { walk, digest, uuid, now, atomicJson, inside } from './storage.ts';
import { Site } from './site.ts';
import { WeavaError, VERSION } from '@weava/contracts';
export async function createBackup(site: Site, base: string, label = '手动备份') {
  const root = resolve(base);
  if (root === site.root || root.startsWith(site.root + '/') || root.startsWith(site.root + '\\'))
    throw new WeavaError('备份目录必须在站点外。');
  const id = now().replace(/[:.]/g, '-') + '-' + uuid().slice(0, 8),
    folder = join(root, id);
  mkdirSync(folder, { recursive: true });
  await site.store.raw.backup(join(folder, 'weava.sqlite'));
  const analytics = join(site.root, 'analytics.sqlite');
  if (existsSync(analytics)) {
    const db = new Database(analytics);
    try {
      await db.backup(join(folder, 'analytics.sqlite'));
    } finally {
      db.close();
    }
  }
  for (const dir of ['media', 'themes', 'extensions', 'imports', 'logs', 'archives'])
    for (const file of walk(join(site.root, dir))) {
      const target = join(folder, relative(site.root, file));
      mkdirSync(resolve(target, '..'), { recursive: true });
      copyFileSync(file, target);
    }
  for (const name of ['site.json', 'cli-token'])
    if (existsSync(join(site.root, name))) copyFileSync(join(site.root, name), join(folder, name));
  const files = walk(folder).map((file) => ({
    path: relative(folder, file).replaceAll('\\', '/'),
    hash: digest(readFileSync(file)),
  }));
  const manifest = { version: 1, framework: VERSION, id, createdAt: now(), label, files };
  atomicJson(join(folder, 'manifest.json'), manifest);
  return { id, path: folder, files: files.length };
}
export function verifyBackup(folder: string) {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files))
    throw new WeavaError('备份清单格式无效。');
  for (const item of manifest.files) {
    const file = inside(folder, item.path);
    if (
      !existsSync(file) ||
      lstatSync(file).isSymbolicLink() ||
      digest(readFileSync(file)) !== item.hash
    )
      throw new WeavaError('备份校验失败：' + item.path);
  }
  return manifest;
}
export async function restoreBackup(folder: string, target: string, backupRoot: string) {
  verifyBackup(folder);
  assertOffline(target);
  recoverRestore(target);
  if (existsSync(join(target, 'weava.sqlite'))) {
    const site = new Site(target);
    try {
      await createBackup(site, backupRoot, '恢复前自动备份');
    } finally {
      site.close();
    }
  }
  const staging = target + '.restore-' + uuid();
  mkdirSync(staging, { recursive: true });
  for (const file of walk(folder)) {
    if (relative(folder, file) === 'manifest.json') continue;
    const to = join(staging, relative(folder, file));
    mkdirSync(resolve(to, '..'), { recursive: true });
    copyFileSync(file, to);
  }
  const check = new Site(staging);
  try {
    if (check.store.raw.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new WeavaError('恢复数据库校验失败。');
  } finally {
    check.close();
  }
  const journal = target + '.restore.json';
  atomicJson(journal, {
    target,
    staging,
    backup: target + '.retained-' + Date.now(),
    status: 'prepared',
  });
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (existsSync(target)) renameSync(target, state.backup);
  atomicJson(journal, { ...state, status: 'displaced' });
  try {
    renameSync(staging, target);
  } catch (error) {
    if (existsSync(state.backup)) renameSync(state.backup, target);
    atomicJson(journal, { ...state, status: 'rolled_back' });
    throw error;
  }
  atomicJson(journal, { ...state, status: 'complete' });
  return { restored: true, target, retained: state.backup };
}
export function recoverRestore(target: string) {
  const journal = target + '.restore.json';
  if (!existsSync(journal)) return { recovered: false };
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (!['prepared', 'displaced'].includes(state.status)) return { recovered: false };
  if (
    state.target !== target ||
    !state.staging?.startsWith(target + '.restore-') ||
    !state.backup?.startsWith(target + '.retained-')
  )
    throw new WeavaError('恢复日志路径无效，请检查：' + journal);
  assertOffline(target);
  if (!existsSync(target) && existsSync(state.backup)) renameSync(state.backup, target);
  else if (!existsSync(target) && existsSync(state.staging)) renameSync(state.staging, target);
  if (!existsSync(join(target, 'weava.sqlite')))
    throw new WeavaError('恢复尚未完成，缺少站点数据库。');
  const db = new Database(join(target, 'weava.sqlite'));
  try {
    const check = db.pragma('integrity_check') as any[];
    if (check.some((r) => Object.values(r)[0] !== 'ok'))
      throw new WeavaError('恢复数据库校验失败。');
  } finally {
    db.close();
  }
  atomicJson(journal, { ...state, status: 'recovered' });
  return { recovered: true, target };
}
export function assertOffline(root: string) {
  const file = join(root, 'runtime.json');
  if (!existsSync(file)) return;
  const runtime = JSON.parse(readFileSync(file, 'utf8'));
  if (runtime.status === 'stopped') return;
  try {
    process.kill(runtime.pid, 0);
  } catch {
    return;
  }
  throw new WeavaError('站点服务仍在运行，请先停止服务。', 409);
}
