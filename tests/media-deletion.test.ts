import Database from 'better-sqlite3';
import {join, dirname} from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {deleteMedia, previewMediaDeletion, recoverMediaDeletions} from '../packages/core/src/media-deletion.ts';
import {migrateStorage} from '../packages/core/src/storage-migrations.ts';
import {indexRecord} from '../packages/core/src/record-indexes.ts';
import type {Site} from '../packages/core/src/site.ts';

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  refs: new Set<string>(),
  locked: '',
  keepStaged: false,
}));
vi.mock('../packages/core/src/maintenance-reference-cache.ts', () => ({
  maintenanceReferences: () => fixture.refs,
}));
vi.mock('../packages/core/src/paths.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../packages/core/src/paths.ts')>(),
  mediaFile: (root: string, path: string) => join(root, path.slice(1)),
}));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
  ...fs,
  existsSync: (path: string) => fixture.files.has(path) || fixture.directories.has(path),
  lstatSync: (path: string) => {
    if (!fixture.files.has(path) && !fixture.directories.has(path)) return undefined;
    return {isFile: () => fixture.files.has(path), isDirectory: () => fixture.directories.has(path), isSymbolicLink: () => false};
  },
  mkdirSync: (path: string) => { fixture.directories.add(path); },
  readdirSync: (path: string) => [...fixture.directories].filter(folder => dirname(folder) === path).map(folder => folder.slice(path.length + 1)),
  readFileSync: (path: string, options: Parameters<typeof fs.readFileSync>[1]) =>
    fixture.files.get(path) ?? fs.readFileSync(path, options),
  writeFileSync: (path: string, value: string) => { fixture.files.set(path, value); },
  renameSync: (from: string, to: string) => {
    if (fixture.locked === from) throw new Error('file in use');
    fixture.files.set(to, fixture.files.get(from)!);
    fixture.files.delete(from);
  },
  unlinkSync: (path: string) => {
    if (fixture.keepStaged && /[\\/]\d+$/.test(path)) throw new Error('file in use');
    fixture.files.delete(path);
  },
  rmdirSync: (path: string) => {
    if ([...fixture.files].some(([file]) => dirname(file) === path)) throw new Error('directory is not empty');
    fixture.directories.delete(path);
  },
  };
});

const root = join('test', 'media-deletion');
const original = '/media/image.webp', derivative = '/media/optimized/image.webp';
const local = (url: string) => join(root, url.slice(1));
let site: Site, db: Database.Database;
beforeEach(() => {
  fixture.files.clear();
  fixture.directories.clear();
  fixture.refs.clear();
  fixture.locked = '';
  fixture.keepStaged = false;
  db = new Database(':memory:');
  migrateStorage(db, root, 0);
  site = {root, store: {
    raw: db,
    get: (scope: string, id: string) => db.prepare("SELECT id,revision FROM records WHERE scope=? AND id=?")
      .get(scope, id) && {
        id, revision: 1,
        value: JSON.parse((db.prepare('SELECT data FROM records WHERE scope=? AND id=?').get(scope, id) as {data:string}).data),
      },
    state: (key: string) => (db.prepare('SELECT value FROM state WHERE key=?').get(key) as {value:string} | undefined)?.value,
    setState: (key: string, value: string) => db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key, value),
  }} as unknown as Site;
  put('media', 'image', {name:'image.webp', url: original, bytes: 100, derivatives: [{url: derivative}]});
  fixture.files.set(local(original), 'original');
  fixture.files.set(local(derivative), 'derivative');
});
afterEach(() => db.close());

function put(scope: string, id: string, value: object) {
  db.prepare('INSERT INTO records VALUES(?,?,1,?,?)').run(scope, id, JSON.stringify(value), '');
  indexRecord(db, scope, id, value, 1, '');
}

it('rechecks references and revisions before touching media files', () => {
  expect(previewMediaDeletion(site, 'image')).toEqual({blocked: null});
  fixture.refs.add(derivative);
  expect(() => deleteMedia(site, 'image', 1)).toThrow(/引用/);
  expect(() => deleteMedia(site, 'image', 2)).toThrow(/变化/);
  expect(fixture.files.has(local(original))).toBe(true);
  expect(db.prepare('SELECT id FROM media_list').all()).toEqual([{id:'image'}]);
});

it('deletes only files exclusive to the selected record and clears its list and variant records', () => {
  put('media', 'shared', {name:'shared.webp', url: derivative, bytes: 12});
  const variant = '/media/optimized/variant.webp';
  put('media-variant', 'variant', {parentId:'image', url:variant});
  fixture.files.set(local(variant), 'variant');
  fixture.refs.add(derivative);
  expect(deleteMedia(site, 'image', 1)).toEqual({id:'image', cleanupPending:false});
  expect([...fixture.files]).toEqual([[local(derivative), 'derivative']]);
  expect(site.store.get('media-variant', 'variant')).toBeUndefined();
  expect(db.prepare('SELECT id FROM media_list').all()).toEqual([{id:'shared'}]);
});

it('restores moved files after a failure and retries cleanup after a committed deletion', () => {
  fixture.locked = local(derivative);
  expect(() => deleteMedia(site, 'image', 1)).toThrow('file in use');
  expect(fixture.files.get(local(original))).toBe('original');
  expect(site.store.get('media', 'image')).toBeDefined();
  fixture.locked = '';
  fixture.keepStaged = true;
  expect(deleteMedia(site, 'image', 1)).toEqual({id:'image', cleanupPending:true});
  expect(site.store.get('media', 'image')).toBeUndefined();
  expect(fixture.files.has(local(original))).toBe(false);
  fixture.keepStaged = false;
  recoverMediaDeletions(site);
  expect(fixture.files.size).toBe(0);
});
