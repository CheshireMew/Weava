import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Block, Release, PublishedEntry, Entry } from '@weava/contracts';
import { plain, tokens } from './documents.ts';

const keyOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Index a page's own authored text, not every article displayed in a dynamic list.
export function blockText(blocks: Block[],entry?:Entry,release?:Release,seen=new Set<string>()): string {
  return blocks.map((block) => {
    const p = {...block.props};
    for(const [key,binding] of Object.entries(block.bindings??{})){const source=binding.source==='site'?release?.settings:binding.source==='field'?entry?.fields:entry;if(source&&Object.hasOwn(source,binding.key))p[key]=(source as any)[binding.key];}
    let own = '';
    if (['text', 'richtext', 'hero', 'image-text', 'callout'].includes(block.type))
      own = [p.eyebrow, p.title, p.description, p.text, p.buttonLabel].filter((value) => typeof value === 'string').join(' ');
    if (['image', 'video'].includes(block.type)) own = [p.alt, p.caption].filter(Boolean).join(' ');
    if (block.type === 'gallery' && Array.isArray(p.images)) own = p.images.map((image) => typeof image === 'string' ? '' : [image.alt, image.caption].filter(Boolean).join(' ')).join(' ');
    if (block.type === 'faq' && Array.isArray(p.items)) own = p.items.map((item) => item.question + ' ' + item.answer).join(' ');
    if (['button', 'attachment'].includes(block.type)) own = String(p.label ?? '');
    if (block.type === 'compatibility') own = plain(String(p.html ?? ''));
    if(block.type==='shared'&&release&&!seen.has(p.layoutId)){const target=release.layouts?.find((layout)=>layout.id===p.layoutId);if(target)own=blockText(target.blocks,entry,release,new Set(seen).add(p.layoutId));}
    return plain(own) + ' ' + blockText(block.children ?? [],entry,release,seen);
  }).join(' ');
}

interface Manifest {
  storageVersion: 2;
  id: string;
  createdAt: string;
  label: string;
  entryKeys: string[];
  settingsKey: string;
  typesKey: string;
  redirectsKey: string;
  termsKey?: string;
  layoutsKey?: string;
}
function object(db: Database.Database, kind: string, value: unknown) {
  const key = keyOf({ kind, value });
  db.prepare('INSERT OR IGNORE INTO publication_objects(key,kind,data) VALUES(?,?,?)').run(key, kind, JSON.stringify(value));
  return key;
}
export function storeRelease(db: Database.Database, release: Release, updateExisting = false) {
  const manifest: Manifest = { storageVersion: 2, id: release.id, createdAt: release.createdAt, label: release.label,
    entryKeys: [], settingsKey: object(db, 'settings', release.settings), typesKey: object(db, 'types', release.types),
    redirectsKey: object(db, 'redirects', release.redirects ?? {}), termsKey: object(db, 'terms', release.terms ?? []),
    layoutsKey: object(db, 'layouts', release.layouts ?? []) };
  const member = db.prepare('INSERT INTO publication_members(release_id,object_key,entry_id,position) VALUES(?,?,?,?)');
  const fts = db.prepare('INSERT INTO publication_fts(object_key,tokens) VALUES(?,?)');
  const indexed = db.prepare('INSERT OR IGNORE INTO publication_search_keys(key) VALUES(?)');
  for (const [position, entry] of release.entries.entries()) {
    const key = object(db, 'entry', entry);
    manifest.entryKeys.push(key);
    const searchText=tokens([entry.title,entry.description,entry.blocks?.length?'':plain(entry.html),blockText(entry.blocks??[],entry,release),entry.categories.join(' '),entry.tags.join(' ')].join(' '));
    const searchKey=keyOf({kind:'search',entryKey:key,text:searchText});
    member.run(release.id, searchKey, entry.id, position);
    if (entry.indexable && entry.visibility !== 'private' && indexed.run(searchKey).changes)
      fts.run(searchKey, searchText);
  }
  if (updateExisting) db.prepare('UPDATE releases SET data=? WHERE id=?').run(JSON.stringify(manifest), release.id);
  else db.prepare('INSERT INTO releases VALUES(?,?,?)').run(release.id, JSON.stringify(manifest), release.createdAt);
}
export function loadRelease(db: Database.Database, raw: string): Release {
  const data = JSON.parse(raw);
  if (data.storageVersion !== 2) return data as Release;
  const read = db.prepare('SELECT data FROM publication_objects WHERE key=?');
  const get = (key: string) => {
    const row = read.get(key) as { data: string } | undefined;
    if (!row) throw new Error('公开版本引用的数据不存在：' + key);
    return JSON.parse(row.data);
  };
  return { id: data.id, createdAt: data.createdAt, label: data.label,
    entries: data.entryKeys.map(get), settings: get(data.settingsKey), types: get(data.typesKey), redirects: get(data.redirectsKey), terms: data.termsKey ? get(data.termsKey) : [],
    ...(data.layoutsKey ? { layouts: get(data.layoutsKey) } : {}) };
}

export function searchRelease(db: Database.Database, release: Release, query: string) {
  const terms = tokens(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const match = terms.map((term) => '"' + term.replaceAll('"', '') + '"').join(' AND ');
  const found = db.prepare(`SELECT m.entry_id id FROM publication_fts f JOIN publication_members m ON m.object_key=f.object_key
    WHERE publication_fts MATCH ? AND m.release_id=? ORDER BY rank,m.position`).all(match, release.id) as { id: string }[];
  const entries = new Map(release.entries.filter((entry) => entry.visibility !== 'private' && entry.indexable).map((entry) => [entry.id, entry]));
  return found.flatMap(({ id }) => {
    const entry = entries.get(id);
    return entry ? [{ id, path: entry.path, title: entry.title, description: entry.description }] : [];
  });
}
