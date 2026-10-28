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
  raw: Database.Database;
  db: ReturnType<typeof drizzle>;
  root: string;
  constructor(root: string, create = true) {
    this.root = resolve(root);
    if (!create && !existsSync(join(this.root, 'weava.sqlite')))
      throw new WeavaError('站点未初始化。');
    mkdirSync(this.root, { recursive: true });
    this.raw = new Database(join(this.root, 'weava.sqlite'));
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('busy_timeout = 5000');
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
    if (version.v > 2) throw new WeavaError('站点数据库版本比当前程序新，请更新 Weava。');
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
    this.db = drizzle(this.raw);
    for (const dir of ['media', 'themes', 'extensions', 'logs', 'archives', 'imports'])
      mkdirSync(join(this.root, dir), { recursive: true });
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
    this.raw.close();
  }
}
