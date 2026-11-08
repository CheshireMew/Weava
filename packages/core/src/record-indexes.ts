import type Database from 'better-sqlite3';
import { indexMediaRecord } from './media-policy.ts';
import { indexListRecord } from './list-index.ts';
import { indexAuthoredMedia, indexRevisionMedia } from './media-reference-index.ts';

/** Update projections in the same transaction as the authored record. */
export function indexRecord(
  db: Database.Database,
  scope: string,
  id: string,
  value: any,
  revision: number,
  timestamp: string,
) {
  if(scope==='publication-plan'||scope==='publication-schedule') {
    const due=typeof value.dueAt==='string'?Date.parse(value.dueAt):NaN;
    if(value.status==='scheduled'&&Number.isFinite(due))db.prepare('INSERT INTO publication_due VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,due_at=excluded.due_at').run(scope,id,revision,due);
    else db.prepare('DELETE FROM publication_due WHERE scope=? AND id=?').run(scope,id);
  }
  indexMediaRecord(db, scope, id, value);
  indexListRecord(db, scope, id, value, revision, timestamp);
  indexAuthoredMedia(db, scope, id, value);
  if (scope === 'entry') indexRevisionMedia(db, revision, value);
  if (scope === 'media')
    db.prepare(
      'INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run('media-version', String(revision));
}
