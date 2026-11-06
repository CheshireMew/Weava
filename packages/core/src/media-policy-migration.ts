import type Database from 'better-sqlite3';
import {
  indexMediaRecord,
  indexReleaseMedia,
  workingMediaCatalog,
  rememberPrivateMedia,
} from './media-policy.ts';
import { entryMediaReferences } from './media-references.ts';
import { loadRelease } from './release-reader.ts';
import { indexPublishedRevisions } from './list-index.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestFile, jsonLines } from './file-io.ts';
import { pathWithin } from './paths.ts';
import { WeavaError, type Release } from '@weava/contracts';
export function migrateMediaPolicy(db: Database.Database) {
  for (const row of db.prepare('SELECT scope,id,data FROM records').all() as {
    scope: string;
    id: string;
    data: string;
  }[])
    indexMediaRecord(db, row.scope, row.id, JSON.parse(row.data));
  const catalog = workingMediaCatalog(db);
  for (const row of db
    .prepare(
      "SELECT data FROM revisions WHERE scope='entry' AND json_extract(data,'$.visibility')='private'",
    )
    .all() as { data: string }[])
    rememberPrivateMedia(db, entryMediaReferences(JSON.parse(row.data), catalog));
  for (const row of db.prepare('SELECT data FROM releases').all() as { data: string }[]) {
    const release = loadRelease(db, row.data);
    indexReleaseMedia(db, release);
    indexPublishedRevisions(db, release);
  }
}

/** Immutable archives remain byte-for-byte intact; repair only their live permission index. */
export function repairArchivedMediaPolicy(db: Database.Database, root: string) {
  for (const row of db.prepare("SELECT id,data FROM records WHERE scope='history-archive'").all() as {id:string;data:string}[]) {
    const record = JSON.parse(row.data), base = join(process.env.WEAVA_RESOURCE_ROOT??root,'archives','history'), folder = join(base,row.id);
    if (!/^[\w-]+$/.test(row.id) || !pathWithin(base,folder)) throw new WeavaError('历史归档路径无效。');
    const manifestFile = join(folder,'manifest.json');
    if (!pathWithin(folder,manifestFile) || digestFile(manifestFile) !== record.manifestHash) throw new WeavaError('历史归档清单校验失败。');
    const manifest = JSON.parse(readFileSync(manifestFile,'utf8'));
    for (const name of ['objects.jsonl','revisions.jsonl','releases.jsonl']) {
      const file = join(folder,name), member = manifest.files?.find((item:any)=>item.name===name);
      if (!member || !pathWithin(folder,file) || digestFile(file)!==member.hash) throw new WeavaError('历史归档文件校验失败：'+name);
    }
    // Retain only catalogs in memory; stream article bodies, including archived-only revisions.
    const catalogs = new Map<string, Pick<Release,'settings'|'types'|'layouts'>>();
    const objects = new Map<string, any>();
    for(const object of jsonLines(join(folder,'objects.jsonl'))) if(['settings','types','layouts'].includes(object.kind)) objects.set(object.key,JSON.parse(object.data));
    for(const release of jsonLines(join(folder,'releases.jsonl'))) {
      const value = JSON.parse(release.data);
      if(value.storageVersion===2) {
        const key=[value.settingsKey,value.typesKey,value.layoutsKey].join(':');
        catalogs.set(key,{settings:objects.get(value.settingsKey),types:objects.get(value.typesKey)??[],layouts:objects.get(value.layoutsKey)??[]});
      } else {
        catalogs.set(value.id,value);
        for(const entry of value.entries??[]) if(entry.visibility==='private') rememberPrivateMedia(db,entryMediaReferences(entry,value));
      }
    }
    const protect = (entry:any) => {
      if(entry.visibility!=='private') return;
      rememberPrivateMedia(db,entryMediaReferences(entry));
      for(const catalog of catalogs.values()) rememberPrivateMedia(db,entryMediaReferences(entry,catalog));
    };
    for(const object of jsonLines(join(folder,'objects.jsonl'))) if(object.kind==='entry') protect(JSON.parse(object.data));
    for(const revision of jsonLines(join(folder,'revisions.jsonl'))) if(revision.scope==='entry') protect(JSON.parse(revision.data));
  }
}
