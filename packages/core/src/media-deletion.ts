import {existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {WeavaError} from '@weava/contracts';
import {uuid} from '../../runtime-common/src/identity.ts';
import {maintenanceReferences} from './maintenance-reference-cache.ts';
import {mediaFile, mediaIdentity} from './paths.ts';
import type {Site} from './site.ts';

function deletionPlan(site: Site, id: string) {
  const row = site.store.get('media', id);
  if (!row) throw new WeavaError('媒体不存在。', 404);
  const db = site.store.raw;
  const variants = db.prepare("SELECT id,json_extract(data,'$.url') url FROM records WHERE scope='media-variant' AND json_extract(data,'$.parentId')=?")
    .all(id) as {id: string; url: string}[];
  const family = db.prepare('SELECT path FROM media_family WHERE media_id=?').all(id) as {path: string}[];
  const paths = new Set([row.value.url, ...(row.value.derivatives ?? []).map((item: {url: string}) => item.url), ...variants.map(item => item.url)].map(mediaIdentity));
  for (const {path} of family) paths.add(path);
  const shared = db.prepare("SELECT 1 FROM media_family f JOIN records r ON r.scope='media' AND r.id=f.media_id WHERE f.path=? AND f.media_id<>? LIMIT 1");
  const owned = [...paths].filter(path => !shared.get(path, id));
  const refs = maintenanceReferences(site, true);
  let blocked: string | null = null;
  if (owned.some(path => refs.has(path))) {
    blocked = '这份媒体正在被内容、站点设置或历史版本引用，不能删除。';
  } else if (db.prepare(`SELECT 1 FROM jobs WHERE status IN ('queued','running')
    AND (operation='media' OR (operation IN ('media-edit','media-variant','media-optimize') AND json_extract(data,'$.payload.id')=?)) LIMIT 1`).get(id)
    || db.prepare("SELECT 1 FROM staged_requests WHERE kind='media-file' AND active_until>? LIMIT 1").get(Date.now())) {
    blocked = '媒体上传或处理尚未完成，请稍后重试。';
  }
  return {row, owned, variants, blocked};
}

export function previewMediaDeletion(site: Site, id: string) {
  const {blocked} = deletionPlan(site, id);
  return {blocked};
}

const stagingRoot = (site: Site) => join(site.root, 'uploads', 'media-deletions');
const receipt = (token: string) => 'media-delete:' + token;

function checkDirectory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WeavaError('媒体删除暂存目录无效。', 409);
}

function finishDeletion(site: Site, token: string) {
  const folder = join(stagingRoot(site), token);
  checkDirectory(folder);
  const manifest = join(folder, 'paths.json');
  if (!existsSync(manifest)) {
    // The process may have stopped before writing the manifest or after clearing it.
    const pending = manifest + '.pending';
    if (existsSync(pending)) unlinkSync(pending);
    rmdirSync(folder);
    site.store.raw.prepare('DELETE FROM state WHERE key=?').run(receipt(token));
    return;
  }
  if (!lstatSync(manifest).isFile()) throw new WeavaError('媒体删除记录无效。', 409);
  const paths: string[] = JSON.parse(readFileSync(manifest, 'utf8'));
  const committed = site.store.state(receipt(token)) === 'committed';
  paths.forEach((path, index) => {
    const staged = join(folder, String(index));
    const stat = lstatSync(staged, {throwIfNoEntry: false});
    if (!stat) return;
    if (!stat.isFile()) throw new WeavaError('媒体删除暂存文件无效。', 409);
    if (committed) unlinkSync(staged);
    else {
      const original = mediaFile(site.root, mediaIdentity(path));
      if (existsSync(original)) throw new WeavaError('媒体原位置已有文件，暂存的原文件已保留。', 409);
      renameSync(staged, original);
    }
  });
  unlinkSync(manifest);
  rmdirSync(folder);
  site.store.raw.prepare('DELETE FROM state WHERE key=?').run(receipt(token));
}

/** Resolve interrupted operations using the receipt written in the same transaction as the media deletion. */
export function recoverMediaDeletions(site: Site) {
  const root = stagingRoot(site);
  if (!existsSync(root)) return;
  checkDirectory(join(site.root, 'uploads'));
  checkDirectory(root);
  site.store.raw.transaction(() => {
    for (const token of readdirSync(root)) {
      if (!/^[a-f0-9-]{36}$/.test(token)) continue;
      try { finishDeletion(site, token); }
      catch (error) {
        if (site.store.state(receipt(token)) !== 'committed') throw error;
        // A file still open on Windows can be removed on the next retry or startup.
      }
    }
  }).immediate();
}

export function deleteMedia(site: Site, id: string, revision: number) {
  recoverMediaDeletions(site);
  const db = site.store.raw, token = uuid(), folder = join(stagingRoot(site), token);
  let staged = false;
  try {
    db.transaction(() => {
      if (site.store.get('media', id)?.revision !== revision)
        throw new WeavaError('媒体已变化，请重新打开删除窗口。', 409);
      const {owned, variants, blocked} = deletionPlan(site, id);
      if (blocked) throw new WeavaError(blocked, 409);
      const files = owned.flatMap(path => {
        const file = mediaFile(site.root, path);
        const stat = lstatSync(file, {throwIfNoEntry: false});
        if (!stat) return [];
        if (!stat.isFile()) throw new WeavaError('媒体路径不是普通文件，无法删除。', 409);
        return [{path, file}];
      });
      if (files.length) {
        mkdirSync(join(site.root, 'uploads'), {recursive: true});
        checkDirectory(join(site.root, 'uploads'));
        mkdirSync(stagingRoot(site), {recursive: true});
        checkDirectory(stagingRoot(site));
        mkdirSync(folder);
        staged = true;
        const manifest = join(folder, 'paths.json');
        writeFileSync(manifest + '.pending', JSON.stringify(files.map(item => item.path)), {flag: 'wx', flush: true});
        renameSync(manifest + '.pending', manifest);
        files.forEach(({file}, index) => renameSync(file, join(folder, String(index))));
        site.store.setState(receipt(token), 'committed');
      }
      const remove = db.prepare('DELETE FROM records WHERE scope=? AND id=?');
      for (const variant of variants) remove.run('media-variant', variant.id);
      remove.run('media', id);
      db.prepare('DELETE FROM media_list WHERE id=?').run(id);
      site.store.setState('media-version', token);
    }).immediate();
  } catch (error) {
    if (staged) recoverMediaDeletions(site);
    throw error;
  }
  if (staged) recoverMediaDeletions(site);
  return {id, cleanupPending: existsSync(folder)};
}
