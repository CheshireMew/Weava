import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { uuid } from '../../runtime-common/src/identity.ts';
import { SCHEMA_VERSION } from './schema-version.ts';
import { migrateMediaPolicy, repairArchivedMediaPolicy } from './media-policy-migration.ts';
import { storeRelease, loadRelease } from './publication-store.ts';
import { mediaPolicySchema } from './media-policy.ts';
import { listIndexSchema, migrateListRecords } from './list-index.ts';
import {
  referenceSchema,
  migrateMediaReferences,
  indexPublishedMedia,
} from './media-reference-index.ts';

export function migrateStorage(db: Database.Database, root: string, previousVersion: number) {
  if (
    previousVersion &&
    previousVersion < SCHEMA_VERSION &&
    process.env.WEAVA_EXTERNAL_RECOVERY !== '1'
  ) {
    const folder = join(root, 'archives', 'schema-upgrades');
    mkdirSync(folder, { recursive: true });
    const backup = join(
      folder,
      `before-v${previousVersion}-to-v${SCHEMA_VERSION}-${uuid()}.sqlite`,
    );
    db.exec('VACUUM INTO ' + "'" + backup.replaceAll("'", "''") + "'");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(scope TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS revisions(revision INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,label TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revision_object ON revisions(scope,id,revision);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,operation TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,idempotency TEXT UNIQUE);
      CREATE UNIQUE INDEX IF NOT EXISTS one_publication ON jobs(operation) WHERE operation='publish' AND status IN ('queued','running');
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS search_documents(release_id TEXT NOT NULL,entry_id TEXT NOT NULL,path TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,PRIMARY KEY(release_id,entry_id));
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(release_id UNINDEXED,entry_id UNINDEXED,tokens,tokenize='unicode61');
      INSERT OR IGNORE INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
  const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as any;
  mediaPolicySchema(db);
  listIndexSchema(db);
  if (version.v < 2)
    db.transaction(() => {
      db.exec(`CREATE TABLE article_likes(entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(entry_id,reader_key));
        CREATE TABLE article_comments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,network_key TEXT NOT NULL,client_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('visible','hidden')),created_at TEXT NOT NULL,UNIQUE(entry_id,reader_key,client_id));
        CREATE INDEX comments_entry ON article_comments(entry_id,status,created_at);
        CREATE INDEX comments_reader ON article_comments(reader_key,created_at);
        CREATE INDEX comments_network ON article_comments(network_key,created_at);
        CREATE TABLE comment_captchas(id TEXT PRIMARY KEY,reader_key TEXT NOT NULL,answer_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE engagement_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 3)
    db.transaction(() => {
      db.exec(`CREATE TABLE publication_objects(key TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
        CREATE TABLE publication_members(release_id TEXT NOT NULL,object_key TEXT NOT NULL,entry_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(release_id,entry_id));
        CREATE INDEX publication_member_object ON publication_members(object_key,release_id);
        CREATE VIRTUAL TABLE publication_fts USING fts5(object_key UNINDEXED,tokens,tokenize='unicode61');
        CREATE TABLE publication_search_keys(key TEXT PRIMARY KEY);`);
      for (const row of db.prepare('SELECT id,data FROM releases').all() as {
        id: string;
        data: string;
      }[]) {
        const release = JSON.parse(row.data);
        if (release.entries) {
          // Old aliases become part of each existing snapshot; future aliases are versioned.
          release.redirects = Object.fromEntries(
            (db.prepare("SELECT id,data FROM records WHERE scope='redirect'").all() as any[]).map(
              (row) => [row.id, JSON.parse(row.data)],
            ),
          );
          storeRelease(db, release, true);
        }
      }
      db.exec("INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 4)
    db.transaction(() => {
      const commentsExist = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_comments'")
        .get();
      if (commentsExist) db.exec('ALTER TABLE article_comments RENAME TO article_comments_v3');
      db.exec(
        `CREATE TABLE article_comments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,network_key TEXT NOT NULL,client_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('visible','hidden','pending')),created_at TEXT NOT NULL,UNIQUE(entry_id,reader_key,client_id));`,
      );
      if (commentsExist)
        db.exec(
          'INSERT INTO article_comments SELECT * FROM article_comments_v3; DROP TABLE article_comments_v3;',
        );
      db.exec(`CREATE INDEX comments_entry ON article_comments(entry_id,status,created_at);
        CREATE INDEX comments_reader ON article_comments(reader_key,created_at);
        CREATE INDEX comments_network ON article_comments(network_key,created_at);
        INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 5)
    db.transaction(() => {
      migrateMediaPolicy(db);
      migrateListRecords(db);
      db.exec("INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 6)
    db.transaction(() => {
      db.exec(
        'CREATE TABLE IF NOT EXISTS owner_sessions(token TEXT PRIMARY KEY,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,user_agent TEXT NOT NULL)',
      );
      db.exec(
        'CREATE TABLE IF NOT EXISTS comment_threads(comment_id TEXT PRIMARY KEY,parent_id TEXT,owner INTEGER NOT NULL DEFAULT 0)',
      );
      db.exec("INSERT INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 7)
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS owner_security_events(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,event TEXT NOT NULL,source TEXT NOT NULL,network_key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_auth_failures(id TEXT PRIMARY KEY,failures INTEGER NOT NULL,expires INTEGER NOT NULL,blocked_until INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 8)
    db.transaction(() => {
      db.exec(`CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS records_scheduled_due ON records(scope,json_extract(data,'$.status'),json_extract(data,'$.dueAt')) WHERE scope IN ('publication-schedule','publication-plan');
        CREATE INDEX IF NOT EXISTS jobs_operation_status ON jobs(operation,status);
        CREATE TABLE IF NOT EXISTS publication_candidates(id TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS publication_candidate_expiry ON publication_candidates(expires);
        CREATE TABLE IF NOT EXISTS publication_search_sources(entry_key TEXT NOT NULL,dependency_key TEXT NOT NULL,search_key TEXT NOT NULL,PRIMARY KEY(entry_key,dependency_key));
        INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 9)
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS media_uploads(id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,offset INTEGER NOT NULL,status TEXT NOT NULL,path TEXT NOT NULL,expires INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,job_id TEXT,idempotency TEXT UNIQUE);
        CREATE INDEX IF NOT EXISTS media_upload_expiry ON media_uploads(status,expires);
        INSERT INTO schema_migrations VALUES(9,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 10)
    db.transaction(() => {
      referenceSchema(db);
      migrateMediaReferences(db);
      let after = 0;
      for (;;) {
        const rows = db
          .prepare('SELECT rowid n,data FROM releases WHERE rowid>? ORDER BY rowid LIMIT 8')
          .all(after) as { n: number; data: string }[];
        if (!rows.length) break;
        for (const row of rows) indexPublishedMedia(db, loadRelease(db, row.data));
        after = rows.at(-1)!.n;
      }
      db.exec("INSERT INTO schema_migrations VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 11)
    db.transaction(() => {
      db.exec(`CREATE INDEX IF NOT EXISTS revision_data_bytes ON revisions(length(CAST(data AS BLOB)));
        CREATE INDEX IF NOT EXISTS release_data_bytes ON releases(length(CAST(data AS BLOB)));`);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='publication_objects'").get())
        db.exec(
          'CREATE INDEX IF NOT EXISTS publication_object_bytes ON publication_objects(kind,length(CAST(data AS BLOB)))',
        );
      db.exec("INSERT INTO schema_migrations VALUES(11,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 12)
    db.transaction(() => {
      // Keep remembered private history, but recompute references and public overrides
      // with the same decoded URLs that the browser actually requests.
      db.exec(
        'DELETE FROM public_media_paths; DELETE FROM authored_media_refs; DELETE FROM authored_layout_edges; DELETE FROM revision_media_refs; DELETE FROM publication_entry_media;',
      );
      db.prepare("DELETE FROM state WHERE key='media-reference-revision'").run();
      migrateMediaPolicy(db);
      migrateMediaReferences(db);
      for (const row of db.prepare('SELECT data FROM releases').all() as { data: string }[])
        indexPublishedMedia(db, loadRelease(db, row.data));
      repairArchivedMediaPolicy(db, root);
      db.exec("INSERT INTO schema_migrations VALUES(12,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
  if (version.v < 13)
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS comment_likes(comment_id TEXT NOT NULL,reader_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(comment_id,reader_key));
        INSERT INTO schema_migrations VALUES(13,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
  if (version.v < 14)
    db.transaction(() => {
      migrateListRecords(db);
      db.exec("INSERT INTO schema_migrations VALUES(14,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
}
