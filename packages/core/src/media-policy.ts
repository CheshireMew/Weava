import type Database from 'better-sqlite3';
import type { Entry, Release } from '@weava/contracts';
import { mediaIdentity } from './paths.ts';
import { builtInLayouts, referencedLayouts } from './layouts.ts';
import { mediaReferencesIn, entryMediaReferences } from './media-references.ts';

export function mediaPolicySchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS private_media_paths(path TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS public_media_paths(release_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(release_id,path));
    CREATE TABLE IF NOT EXISTS media_family(media_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(media_id,path));
    CREATE INDEX IF NOT EXISTS media_family_path ON media_family(path,media_id);
    CREATE TABLE IF NOT EXISTS media_parents(child TEXT PRIMARY KEY,parent TEXT NOT NULL);`);
}
export function rememberPrivateMedia(db: Database.Database, paths: Iterable<string>) {
  const insert = db.prepare('INSERT OR IGNORE INTO private_media_paths VALUES(?)');
  for (const path of paths) insert.run(path);
}
export function workingMediaCatalog(db: Database.Database): Pick<Release,'settings'|'types'|'layouts'> | undefined {
  const list = (scope: string) => (db.prepare('SELECT data FROM records WHERE scope=?').all(scope) as {data:string}[]).map(row => JSON.parse(row.data));
  const settings = list('settings')[0];
  if (!settings) return;
  const stored = list('layout');
  return { settings, types: list('type'), layouts: [...builtInLayouts.filter(layout => !stored.some(item => item.id === layout.id)), ...stored] };
}
/** Called in the same transaction as the record write. Historical private refs never expire. */
export function indexMediaRecord(db: Database.Database, scope: string, id: string, value: any) {
  if (scope === 'entry' && value.visibility === 'private') rememberPrivateMedia(db, entryMediaReferences(value, workingMediaCatalog(db)));
  if (['layout','type','settings'].includes(scope)) {
    const catalog = workingMediaCatalog(db);
    for (const row of db.prepare("SELECT data FROM records WHERE scope='entry' AND json_extract(data,'$.visibility')='private'").all() as {data:string}[]) rememberPrivateMedia(db, entryMediaReferences(JSON.parse(row.data), catalog));
  }
  if (scope === 'history-archive') rememberPrivateMedia(db, (value.privateMedia ?? []).map(mediaIdentity));
  if (scope === 'media') {
    const insert = db.prepare('INSERT OR IGNORE INTO media_family VALUES(?,?)');
    for (const path of [value.url, ...(value.derivatives ?? []).map((item:any) => item.url)]) if (path) insert.run(id,mediaIdentity(path));
    if (value.parentId) db.prepare('INSERT INTO media_parents VALUES(?,?) ON CONFLICT(child) DO UPDATE SET parent=excluded.parent').run(id,value.parentId);
  }
  if (scope === 'media-variant') db.prepare('INSERT OR IGNORE INTO media_family VALUES(?,?)').run(value.parentId,mediaIdentity(value.url));
}
export function indexReleaseMedia(db: Database.Database, release: Release) {
  const pub = db.prepare('INSERT OR IGNORE INTO public_media_paths VALUES(?,?)');
  for (const entry of release.entries) {
    const refs = entryMediaReferences(entry,release);
    if (entry.visibility === 'private') rememberPrivateMedia(db,refs);
    else for (const path of refs) pub.run(release.id,path);
  }
  for (const path of mediaReferencesIn([release.settings,referencedLayouts(undefined,release)])) pub.run(release.id,path);
}
export function privateMedia(db: Database.Database, input: string) {
  const path = mediaIdentity(input);
  // Public reuse overrides private history only within the same original/derivative family.
  if (db.prepare(`SELECT 1 FROM public_media_paths p WHERE p.release_id=(SELECT value FROM state WHERE key='release')
    AND (p.path=? OR p.path IN (SELECT f.path FROM media_family f JOIN media_family own ON own.media_id=f.media_id WHERE own.path=?)) LIMIT 1`).get(path,path)) return false;
  return !!db.prepare(`WITH RECURSIVE family(id) AS (
      SELECT media_id FROM media_family WHERE path=? UNION SELECT p.parent FROM media_parents p JOIN family f ON p.child=f.id
    ) SELECT 1 FROM private_media_paths p WHERE p.path=? OR p.path IN (SELECT path FROM media_family WHERE media_id IN family) LIMIT 1`).get(path,path);
}
