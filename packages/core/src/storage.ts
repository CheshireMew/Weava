import { migrateMediaPolicy } from './media-policy-migration.ts';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { eq, and } from 'drizzle-orm';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { WeavaError } from '@weava/contracts';
import { storeRelease,loadRelease } from './publication-store.ts';
import { acquireInstanceWriter, withInstanceMaintenance, type InstanceWriter } from './instance-access.ts';
import { mediaPolicySchema, indexMediaRecord } from './media-policy.ts';
import { listIndexSchema, migrateListRecords, indexListRecord } from './list-index.ts';
import { referenceSchema,migrateMediaReferences,indexAuthoredMedia,indexRevisionMedia,indexPublishedMedia } from './media-reference-index.ts';
export const SCHEMA_VERSION = 11;
export const records = sqliteTable('records', {
  scope: text().notNull(),
  id: text().notNull(),
  revision: integer().notNull(),
  data: text().notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const now = () => new Date().toISOString();
export const digest = (value: any) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export const uuid = () => randomUUID();
export function inside(root: string, input: string) {
  const path = resolve(root, input);
  const rel = relative(resolve(root), path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new WeavaError('路径超出站点目录。');
  return path;
}
export function atomicJson(path: string, value: any) {
  const next = path + '.pending-' + uuid();
  writeFileSync(next, JSON.stringify(value, null, 2));
  renameSync(next, path);
}
export function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name),
      stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new WeavaError('目录中存在链接，请使用普通目录：' + file);
    if (stat.isDirectory()) result.push(...walk(file));
    else if (stat.isFile()) result.push(file);
  }
  return result;
}
export class Storage {
  raw!: Database.Database;
  db: ReturnType<typeof drizzle>;
  root: string;
  private writer: InstanceWriter;
  constructor(root: string, create = true) {
    this.root = resolve(root);
    if (!create && !existsSync(join(this.root, 'weava.sqlite')))
      throw new WeavaError('站点未初始化。');
    this.writer = acquireInstanceWriter(this.root);
    try {
    mkdirSync(this.root, { recursive: true });
    this.raw = new Database(join(this.root, 'weava.sqlite'));
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('busy_timeout = 5000');
    const initialized = this.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get();
    const previousVersion = initialized ? (this.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as any).v : 0;
    if (previousVersion > SCHEMA_VERSION) { this.raw.close(); throw new WeavaError('站点数据库版本比当前程序新，请更新 Weava。'); }
    const initialize = () => {
    if (previousVersion && previousVersion < SCHEMA_VERSION) {
      const folder = join(this.root, 'archives', 'schema-upgrades');
      mkdirSync(folder, { recursive: true });
      const backup = join(folder, `before-v${previousVersion}-to-v${SCHEMA_VERSION}-${uuid()}.sqlite`);
      this.raw.exec('VACUUM INTO ' + "'" + backup.replaceAll("'", "''") + "'");
    }
    this.raw
      .exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
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
    const version = this.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get() as any;
    mediaPolicySchema(this.raw);
    listIndexSchema(this.raw);
    if (version.v < 2) this.raw.transaction(() => {
      this.raw.exec(`CREATE TABLE article_likes(entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(entry_id,reader_key));
        CREATE TABLE article_comments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,network_key TEXT NOT NULL,client_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('visible','hidden')),created_at TEXT NOT NULL,UNIQUE(entry_id,reader_key,client_id));
        CREATE INDEX comments_entry ON article_comments(entry_id,status,created_at);
        CREATE INDEX comments_reader ON article_comments(reader_key,created_at);
        CREATE INDEX comments_network ON article_comments(network_key,created_at);
        CREATE TABLE comment_captchas(id TEXT PRIMARY KEY,reader_key TEXT NOT NULL,answer_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE engagement_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
    if (version.v < 3) this.raw.transaction(() => {
      this.raw.exec(`CREATE TABLE publication_objects(key TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
        CREATE TABLE publication_members(release_id TEXT NOT NULL,object_key TEXT NOT NULL,entry_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(release_id,entry_id));
        CREATE INDEX publication_member_object ON publication_members(object_key,release_id);
        CREATE VIRTUAL TABLE publication_fts USING fts5(object_key UNINDEXED,tokens,tokenize='unicode61');
        CREATE TABLE publication_search_keys(key TEXT PRIMARY KEY);`);
      for (const row of this.raw.prepare('SELECT id,data FROM releases').all() as { id: string; data: string }[]) {
        const release = JSON.parse(row.data);
        if (release.entries) {
          // Old aliases become part of each existing snapshot; future aliases are versioned.
          release.redirects = Object.fromEntries((this.raw.prepare("SELECT id,data FROM records WHERE scope='redirect'").all() as any[]).map((row) => [row.id, JSON.parse(row.data)]));
          storeRelease(this.raw, release, true);
        }
      }
      this.raw.exec("INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
    if (version.v < 4) this.raw.transaction(() => {
      const commentsExist = this.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_comments'").get();
      if (commentsExist) this.raw.exec('ALTER TABLE article_comments RENAME TO article_comments_v3');
      this.raw.exec(`CREATE TABLE article_comments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,reader_key TEXT NOT NULL,network_key TEXT NOT NULL,client_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('visible','hidden','pending')),created_at TEXT NOT NULL,UNIQUE(entry_id,reader_key,client_id));`);
      if (commentsExist) this.raw.exec('INSERT INTO article_comments SELECT * FROM article_comments_v3; DROP TABLE article_comments_v3;');
      this.raw.exec(`CREATE INDEX comments_entry ON article_comments(entry_id,status,created_at);
        CREATE INDEX comments_reader ON article_comments(reader_key,created_at);
        CREATE INDEX comments_network ON article_comments(network_key,created_at);
        INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
    if (version.v < 5) this.raw.transaction(() => {
      migrateMediaPolicy(this.raw);
      migrateListRecords(this.raw);
      this.raw.exec("INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
    if (version.v < 6) this.raw.transaction(() => {
      this.raw.exec('CREATE TABLE IF NOT EXISTS owner_sessions(token TEXT PRIMARY KEY,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,user_agent TEXT NOT NULL)');
      this.raw.exec('CREATE TABLE IF NOT EXISTS comment_threads(comment_id TEXT PRIMARY KEY,parent_id TEXT,owner INTEGER NOT NULL DEFAULT 0)');
      this.raw.exec("INSERT INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
    if (version.v < 7) this.raw.transaction(() => {
      this.raw.exec(`CREATE TABLE IF NOT EXISTS owner_security_events(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,event TEXT NOT NULL,source TEXT NOT NULL,network_key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_auth_failures(id TEXT PRIMARY KEY,failures INTEGER NOT NULL,expires INTEGER NOT NULL,blocked_until INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
    if (version.v < 8) this.raw.transaction(() => {
      this.raw.exec(`CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS records_scheduled_due ON records(scope,json_extract(data,'$.status'),json_extract(data,'$.dueAt')) WHERE scope IN ('publication-schedule','publication-plan');
        CREATE INDEX IF NOT EXISTS jobs_operation_status ON jobs(operation,status);
        CREATE TABLE IF NOT EXISTS publication_candidates(id TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS publication_candidate_expiry ON publication_candidates(expires);
        CREATE TABLE IF NOT EXISTS publication_search_sources(entry_key TEXT NOT NULL,dependency_key TEXT NOT NULL,search_key TEXT NOT NULL,PRIMARY KEY(entry_key,dependency_key));
        INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
    if(version.v<9)this.raw.transaction(()=>{
      this.raw.exec(`CREATE TABLE IF NOT EXISTS media_uploads(id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,offset INTEGER NOT NULL,status TEXT NOT NULL,path TEXT NOT NULL,expires INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,job_id TEXT,idempotency TEXT UNIQUE);
        CREATE INDEX IF NOT EXISTS media_upload_expiry ON media_uploads(status,expires);
        INSERT INTO schema_migrations VALUES(9,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    }).immediate();
    if(version.v<10)this.raw.transaction(()=>{
      referenceSchema(this.raw);migrateMediaReferences(this.raw);
      let after=0;for(;;){const rows=this.raw.prepare('SELECT rowid n,data FROM releases WHERE rowid>? ORDER BY rowid LIMIT 8').all(after) as {n:number;data:string}[];if(!rows.length)break;for(const row of rows)indexPublishedMedia(this.raw,loadRelease(this.raw,row.data));after=rows.at(-1)!.n;}
      this.raw.exec("INSERT INTO schema_migrations VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
    if(version.v<11)this.raw.transaction(()=>{
      this.raw.exec(`CREATE INDEX IF NOT EXISTS revision_data_bytes ON revisions(length(CAST(data AS BLOB)));
        CREATE INDEX IF NOT EXISTS release_data_bytes ON releases(length(CAST(data AS BLOB)));`);
      if(this.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='publication_objects'").get())this.raw.exec('CREATE INDEX IF NOT EXISTS publication_object_bytes ON publication_objects(kind,length(CAST(data AS BLOB)))');
      this.raw.exec("INSERT INTO schema_migrations VALUES(11,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }).immediate();
    };
    if (previousVersion && previousVersion < SCHEMA_VERSION) this.maintain(initialize);
    else initialize();
    this.db = drizzle(this.raw);
    for (const dir of ['media', 'themes', 'extensions', 'logs', 'archives', 'imports'])
      mkdirSync(join(this.root, dir), { recursive: true });
    } catch (error) {
      if (this.raw?.open) this.raw.close();
      this.writer.release(); throw error;
    }
  }
  get(scope: string, id: string) {
    const row = this.db
      .select()
      .from(records)
      .where(and(eq(records.scope, scope), eq(records.id, id)))
      .get();
    return row
      ? {
          id: row.id,
          revision: row.revision,
          value: JSON.parse(row.data),
          updatedAt: row.updatedAt,
        }
      : null;
  }
  list(scope: string) {
    return this.db
      .select()
      .from(records)
      .where(eq(records.scope, scope))
      .all()
      .map((row) => ({
        id: row.id,
        revision: row.revision,
        value: JSON.parse(row.data),
        updatedAt: row.updatedAt,
      }));
  }
  put(scope: string, id: string, value: any, expected: number | null, label = '保存') {
    return this.raw
      .transaction(() => {
        const current = this.get(scope, id);
        if ((current?.revision ?? null) !== expected)
          throw new WeavaError('内容已被其他窗口修改，请重新载入。', 409, {
            scope,
            id,
            currentRevision: current?.revision,
          });
        if (current && JSON.stringify(current.value) === JSON.stringify(value)) return current;
        const timestamp = now(),
          revision = Number(
            this.raw
              .prepare('INSERT INTO revisions(scope,id,data,created_at,label) VALUES(?,?,?,?,?)')
              .run(scope, id, JSON.stringify(value), timestamp, label).lastInsertRowid,
          );
        this.raw
          .prepare(
            'INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at',
          )
          .run(scope, id, revision, JSON.stringify(value), timestamp);
        indexMediaRecord(this.raw, scope, id, value);
        indexListRecord(this.raw, scope, id, value, revision, timestamp);
        indexAuthoredMedia(this.raw,scope,id,value);if(scope==='entry')indexRevisionMedia(this.raw,revision,value);
        if(scope==='media')this.setState('media-version',String(revision));
        return { id, revision, value, updatedAt: timestamp };
      })
      .immediate();
  }
  history(scope: string, id: string) {
    return (
      this.raw
        .prepare(
          'SELECT revision,created_at,label FROM revisions WHERE scope=? AND id=? ORDER BY revision DESC',
        )
        .all(scope, id) as any[]
    ).map((r) => ({ revision: r.revision, createdAt: r.created_at, label: r.label }));
  }
  restore(scope: string, id: string, revision: number, expected: number) {
    const row = this.raw
      .prepare('SELECT data FROM revisions WHERE scope=? AND id=? AND revision=?')
      .get(scope, id, revision) as any;
    if (!row) throw new WeavaError('版本不存在。', 404);
    return this.put(scope, id, JSON.parse(row.data), expected, '恢复历史版本');
  }
  state(key: string) {
    return (this.raw.prepare('SELECT value FROM state WHERE key=?').get(key) as any)?.value;
  }
  setState(key: string, value: string) {
    this.raw
      .prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }
  close() {
    if (this.raw.open) this.raw.close();
    this.writer.release();
  }
  maintain<T>(action: () => T): T { return withInstanceMaintenance(this.root, action, this.writer); }
}
