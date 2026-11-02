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
