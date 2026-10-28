import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import type { Site } from './site.ts';
import { WeavaError, type Entry } from '@weava/contracts';
import { digest, inside, now, uuid, SCHEMA_VERSION, atomicJson } from './storage.ts';
import { loadRelease, storeRelease } from './publication-store.ts';
import {referencedLayouts} from './layouts.ts';

export interface HistoryRetention { before: string; keepReleases?: number; keepRevisions?: number }
interface Plan { options: Required<HistoryRetention>; releaseIds: string[]; revisions: number[]; privateMedia: string[]; protectedReleases: number; protectedRevisions: number; review: string }
function mediaUrls(value: unknown) { return [...new Set([...JSON.stringify(value).matchAll(/\/media\/[\w%./@+~-]+/g)].map((match) => decodeURIComponent(match[0].replace(/[\\]+$/, ''))))]; }
function objectKeys(data: string): string[] {
  const manifest = JSON.parse(data);
  if (manifest.storageVersion !== 2) return [];
  return [...manifest.entryKeys, manifest.settingsKey, manifest.typesKey, manifest.redirectsKey, manifest.termsKey, manifest.layoutsKey].filter(Boolean);
}
export function planHistoryArchive(site: Site, input: HistoryRetention): Plan {
  const options = { before: input.before, keepReleases: input.keepReleases ?? 20, keepRevisions: input.keepRevisions ?? 20 };
  if (!Number.isFinite(Date.parse(options.before)) || !Number.isSafeInteger(options.keepReleases) || options.keepReleases < 1 || !Number.isSafeInteger(options.keepRevisions) || options.keepRevisions < 1) throw new WeavaError('归档时间和保留数量无效，至少保留一个版本。');
  options.before = new Date(options.before).toISOString();
  const releases = site.store.raw.prepare('SELECT id,data,created_at FROM releases ORDER BY created_at DESC,rowid DESC').all() as { id: string; data: string; created_at: string }[];
  const protectedReleases = new Set([site.store.state('release'), ...releases.slice(0,options.keepReleases).map((row) => row.id)]);
  const releaseIds = releases.filter((row) => row.created_at < options.before && !protectedReleases.has(row.id)).map((row) => row.id);
  const protectedRevisions = new Set((site.store.raw.prepare('SELECT revision FROM records').all() as {revision:number}[]).map((row) => row.revision));
  for (const row of releases.filter((row) => !releaseIds.includes(row.id))) for (const entry of loadRelease(site.store.raw,row.data).entries) if (entry.revisionId) protectedRevisions.add(entry.revisionId);
  for (const row of site.store.list('publication-schedule')) if (['scheduled','running','failed'].includes(row.value.status)) protectedRevisions.add(row.value.entryRevision);
  const seen = new Map<string,number>(), revisions: number[] = [], privateMedia = new Set<string>();
  for(const row of releases.filter((row)=>releaseIds.includes(row.id))){const release=loadRelease(site.store.raw,row.data);for(const entry of release.entries)if(entry.visibility==='private')for(const path of mediaUrls([entry.cover,entry.document,entry.blocks,entry.fields,referencedLayouts(entry,release)]))privateMedia.add(path);}
  for (const row of site.store.raw.prepare('SELECT revision,scope,id,data,created_at FROM revisions ORDER BY revision DESC').iterate() as Iterable<{revision:number;scope:string;id:string;data:string;created_at:string}>) {
    const key = row.scope + ':' + row.id, count = (seen.get(key) ?? 0) + 1; seen.set(key,count);
    if (protectedRevisions.has(row.revision) || count <= options.keepRevisions || row.created_at >= options.before) { protectedRevisions.add(row.revision); continue; }
    revisions.push(row.revision);
    if (row.scope === 'entry') { const entry: Entry = JSON.parse(row.data); if (entry.visibility === 'private') for (const path of mediaUrls([entry.cover,entry.blocks,entry.document,entry.fields])) privateMedia.add(path); }
  }
  const state = { options, releaseIds, revisions, current: site.store.state('release'), maxRevision: (site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as any).n, releaseCount: releases.length };
  return { options, releaseIds, revisions, privateMedia: [...privateMedia], protectedReleases: releases.length-releaseIds.length, protectedRevisions: protectedRevisions.size, review: digest(state) };
}
const readLines = (path: string): any[] => readFileSync(path,'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
function writeRows(path: string, rows: Iterable<unknown>) {
  const handle = openSync(path,'wx'); let count = 0;
  try { for (const row of rows) { writeSync(handle,JSON.stringify(row)+'\n'); count++; } } finally { closeSync(handle); }
  return { count, hash: digest(readFileSync(path)) };
}
export function historyArchives(site: Site) { return site.store.list('history-archive').map((row) => ({id:row.id,...row.value,revision:row.revision})); }
export function verifyHistoryArchive(site: Site, id: string) {
  const row = site.store.get('history-archive',id); if (!row) throw new WeavaError('历史归档不存在。',404);
  const folder = inside(join(site.root,'archives','history'),id), manifestPath = join(folder,'manifest.json');
  const bytes = readFileSync(manifestPath);
  if (digest(bytes) !== row.value.manifestHash) throw new WeavaError('归档清单校验失败。');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.version !== 1 || manifest.schemaVersion > SCHEMA_VERSION) throw new WeavaError('归档格式与当前程序不兼容。');
  for (const file of manifest.files) if (digest(readFileSync(inside(folder,file.name))) !== file.hash) throw new WeavaError('归档校验失败：'+file.name);
  return {folder,manifest};
}
export async function archiveHistory(site: Site, options: HistoryRetention, review: string) {
  const plan = planHistoryArchive(site,options); if (plan.review !== review) throw new WeavaError('历史或工作稿已经变化，请重新预检归档。',409);
  if (!plan.releaseIds.length && !plan.revisions.length) return { archived:false,releases:0,revisions:0 };
  const id = uuid(), folder = join(site.root,'archives','history',id); mkdirSync(folder,{recursive:true});
  const keys = new Set<string>(), releases: any[] = [], revisions: any[] = [];
  const getRelease = site.store.raw.prepare('SELECT id,data,created_at FROM releases WHERE id=?'), getRevision = site.store.raw.prepare('SELECT revision,scope,id,data,created_at,label FROM revisions WHERE revision=?');
  for (const id of plan.releaseIds) { const row = getRelease.get(id) as any; releases.push(row); objectKeys(row.data).forEach((key) => keys.add(key)); }
  for (const revision of plan.revisions) revisions.push(getRevision.get(revision));
  const getObject = site.store.raw.prepare('SELECT key,kind,data FROM publication_objects WHERE key=?');
  const files = [
    ['releases.jsonl',releases],['revisions.jsonl',revisions],['objects.jsonl',(function*(){for(const key of keys) yield getObject.get(key);})()],
  ] as const;
  const manifests = files.map(([name,rows]) => ({name,...writeRows(join(folder,name),rows)}));
  const manifest = {version:1,schemaVersion:SCHEMA_VERSION,id,createdAt:now(),options:plan.options,files:manifests,review};
  atomicJson(join(folder,'manifest.json'),manifest);
  for (const file of manifests) if (digest(readFileSync(join(folder,file.name))) !== file.hash) throw new WeavaError('归档写入校验失败。');
  site.store.raw.transaction(() => {
    if (planHistoryArchive(site,options).review !== review) throw new WeavaError('历史或工作稿已经变化，已准备的归档继续保留，请重新预检。',409);
    const removeMember = site.store.raw.prepare('DELETE FROM publication_members WHERE release_id=?'), removeRelease = site.store.raw.prepare('DELETE FROM releases WHERE id=?'), removeRevision = site.store.raw.prepare('DELETE FROM revisions WHERE revision=?');
    for (const id of plan.releaseIds) { removeMember.run(id); removeRelease.run(id); site.store.raw.prepare('DELETE FROM search_documents WHERE release_id=?').run(id); site.store.raw.prepare('DELETE FROM search_fts WHERE release_id=?').run(id); }
    for (const revision of plan.revisions) removeRevision.run(revision);
    const used = new Set<string>(); for (const row of site.store.raw.prepare('SELECT data FROM releases').iterate() as Iterable<{data:string}>) objectKeys(row.data).forEach((key) => used.add(key));
    const removeObject = site.store.raw.prepare('DELETE FROM publication_objects WHERE key=?');
    for (const row of site.store.raw.prepare('SELECT key FROM publication_objects').all() as {key:string}[]) if (!used.has(row.key)) removeObject.run(row.key);
    site.store.raw.exec('DELETE FROM publication_fts WHERE object_key NOT IN (SELECT object_key FROM publication_members);DELETE FROM publication_search_keys WHERE key NOT IN (SELECT object_key FROM publication_members)');
    site.store.put('history-archive',id,{createdAt:manifest.createdAt,releases:releases.length,revisions:revisions.length,path:folder,manifestHash:digest(readFileSync(join(folder,'manifest.json'))),privateMedia:plan.privateMedia},null,'归档历史');
  }).immediate();
  return {archived:true,id,path:folder,releases:releases.length,revisions:revisions.length};
}
export function historyArchiveContents(site: Site,id: string) {
  const {folder} = verifyHistoryArchive(site,id);
  return {id,releases:readLines(join(folder,'releases.jsonl')).map((row) => ({id:row.id,createdAt:row.created_at})),revisions:readLines(join(folder,'revisions.jsonl')).map((row) => ({revision:row.revision,id:row.id,scope:row.scope,createdAt:row.created_at,label:row.label}))};
}
export function restoreHistoryArchive(site: Site,id: string) {
  const {folder} = verifyHistoryArchive(site,id), releases = readLines(join(folder,'releases.jsonl')), revisions = readLines(join(folder,'revisions.jsonl')), objects = readLines(join(folder,'objects.jsonl'));
  const db = site.store.raw;
  return db.transaction(() => {
    for (const row of objects) { const current = db.prepare('SELECT kind,data FROM publication_objects WHERE key=?').get(row.key) as any; if (current && (current.kind !== row.kind || current.data !== row.data)) throw new WeavaError('归档对象与当前对象冲突。',409); db.prepare('INSERT OR IGNORE INTO publication_objects VALUES(?,?,?)').run(row.key,row.kind,row.data); }
    let restoredRevisions = 0, restoredReleases = 0;
    for (const row of revisions) {
      const current = db.prepare('SELECT scope,id,data,created_at,label FROM revisions WHERE revision=?').get(row.revision) as any;
      if (current) { if (current.scope !== row.scope || current.id !== row.id || current.data !== row.data || current.created_at !== row.created_at || current.label !== row.label) throw new WeavaError('归档修订与当前修订冲突。',409); continue; }
      db.prepare('INSERT INTO revisions(revision,scope,id,data,created_at,label) VALUES(?,?,?,?,?,?)').run(row.revision,row.scope,row.id,row.data,row.created_at,row.label); restoredRevisions++;
    }
    for (const row of releases) {
      const current = db.prepare('SELECT data FROM releases WHERE id=?').get(row.id) as any;
      if (current) { if (current.data !== row.data) throw new WeavaError('归档公开版本与当前版本冲突。',409); continue; }
      storeRelease(db,loadRelease(db,row.data)); restoredReleases++;
    }
    return {id,restoredReleases,restoredRevisions,currentReleaseId:site.store.state('release')};
  }).immediate();
}
export async function compactDatabase(site: Site) {
  const folder = join(site.root,'archives','database-maintenance'); mkdirSync(folder,{recursive:true}); const backup = join(folder,'before-compact-'+uuid()+'.sqlite');
  await site.store.raw.backup(backup);
  site.store.raw.pragma('wal_checkpoint(TRUNCATE)'); site.store.raw.exec('VACUUM');
  const integrity = site.store.raw.pragma('integrity_check',{simple:true}); if (integrity !== 'ok') throw new WeavaError('数据库整理后的完整性检查失败。');
  return {compacted:true,backup,integrity};
}
