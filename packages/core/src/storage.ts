import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
import {eq,and} from 'drizzle-orm';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {WeavaError} from '@weava/contracts';
import {acquireInstanceWriter,withInstanceMaintenance,type InstanceWriter} from './instance-access.ts';
import {SCHEMA_VERSION} from './schema-version.ts';
export {SCHEMA_VERSION} from './schema-version.ts';
import {migrateStorage} from './storage-migrations.ts';
import {indexRecord} from './record-indexes.ts';
import {now} from '../../runtime-common/src/identity.ts';
export {now,digest,uuid} from '../../runtime-common/src/identity.ts';
export {atomicJson,walk} from '../../runtime-common/src/files.ts';
export {inside} from '../../runtime-common/src/paths.ts';
export const records = sqliteTable('records', {
  scope: text().notNull(),
  id: text().notNull(),
  revision: integer().notNull(),
  data: text().notNull(),
  updatedAt: text('updated_at').notNull(),
});
export class Storage {
  raw!: Database.Database;
  db: ReturnType<typeof drizzle>;
  root: string;
  private writer: InstanceWriter;
  constructor(root: string, create = true, mode: 'open' | 'migrate' = process.env.WEAVA_DATABASE_MODE === 'migrate' ? 'migrate' : 'open') {
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
    if (previousVersion && previousVersion < SCHEMA_VERSION && mode !== 'migrate')
      throw new WeavaError(`站点数据库版本 ${previousVersion} 需要迁移到 ${SCHEMA_VERSION}，请使用 site update 或 site adopt；普通打开不会迁移数据。`, 409);
    const initialize = () => migrateStorage(this.raw, this.root, previousVersion);
    if (previousVersion && previousVersion < SCHEMA_VERSION) this.maintain(initialize);
    else if (!previousVersion) initialize();
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
        this.assertTask();
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
        indexRecord(this.raw, scope, id, value, revision, timestamp);
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
    this.raw.transaction(()=>{this.assertTask();this.raw
      .prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);}).immediate();
  }
  assertTask(){
    if(!process.env.WEAVA_JOB_ID||process.env.WEAVA_JOB_ROOT!==this.root)return;
    const row=this.raw.prepare('SELECT data FROM jobs WHERE id=?').get(process.env.WEAVA_JOB_ID) as {data:string}|undefined;
    const job=row?JSON.parse(row.data):null;
    if(!job||job.cancelRequestedAt||job.deadlineAt&&Date.now()>=job.deadlineAt)throw new WeavaError('任务已取消或超过执行期限。',409);
  }
  close() {
    if (this.raw.open) this.raw.close();
    this.writer.release();
  }
  maintain<T>(action: () => T): T { return withInstanceMaintenance(this.root, action, this.writer); }
}
