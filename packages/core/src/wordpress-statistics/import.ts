import Database from 'better-sqlite3';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { withInstanceMaintenance } from '../instance-access.ts';
import { planWordpressStatistics, mappings } from './plan.ts';
import {
  stable,
  readWordpressStatistics,
  metadata,
  inspectWordpressStatistics,
  tableNames,
} from './format.ts';
import { verifyWordpressStatistics } from './verify.ts';
import { activeSource } from './store.ts';

export function initialize(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS wp_statistics_sources(source_id TEXT PRIMARY KEY,site_url TEXT NOT NULL,fingerprint TEXT NOT NULL,content_hash TEXT NOT NULL,captured_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wp_statistics_snapshots(fingerprint TEXT PRIMARY KEY,source_id TEXT NOT NULL,content_hash TEXT NOT NULL,captured_at TEXT NOT NULL,imported_at TEXT NOT NULL,archive TEXT NOT NULL,metadata TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wp_statistics_rows(fingerprint TEXT NOT NULL,table_name TEXT NOT NULL,row_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(fingerprint,table_name,row_id));
  CREATE TABLE IF NOT EXISTS wp_statistics_page_map(fingerprint TEXT NOT NULL,page_id INTEGER NOT NULL,path TEXT,entry_id TEXT,PRIMARY KEY(fingerprint,page_id));
  CREATE INDEX IF NOT EXISTS wp_statistics_source_snapshots ON wp_statistics_snapshots(source_id,captured_at);`);
}

export async function importWordpressStatistics(
  input: string,
  target: string,
  reviewInput: unknown,
) {
  const plan = planWordpressStatistics(input, target);
  if (stable(reviewInput) !== stable(plan.review))
    throw new WeavaError('来源、目标或页面映射已变化，请重新预检。', 409);
  if (plan.action === 'unchanged') {
    verifyWordpressStatistics(plan.target, plan.sourceId);
    return { ...plan, changed: false, backup: null };
  }
  return withInstanceMaintenance(plan.target, async () => {
    const snapshot = readWordpressStatistics(input);
    if (metadata(snapshot).fingerprint !== plan.fingerprint)
      throw new WeavaError('快照文件在预检后发生变化。', 409);
    const map = mappings(plan.target, snapshot),
      archive = join(plan.target, 'imports', 'wp-statistics', plan.fingerprint);
    if (map.hash !== plan.review.mappingHash)
      throw new WeavaError('页面映射已变化，请重新预检。', 409);
    const db = new Database(join(plan.target, 'analytics.sqlite'), { fileMustExist: true });
    db.pragma('busy_timeout=5000');
    try {
      mkdirSync(archive, { recursive: true });
      const backup = join(archive, 'before-' + crypto.randomUUID() + '.sqlite');
      await db.backup(backup);
      const snapshotFile = join(archive, 'snapshot.json');
      if (!existsSync(snapshotFile))
        writeFileSync(snapshotFile, JSON.stringify(snapshot), { flag: 'wx' });
      else if (metadata(readWordpressStatistics(snapshotFile)).fingerprint !== plan.fingerprint)
        throw new WeavaError('已有快照归档校验失败。');
      const result = db
        .transaction(() => {
          const current = activeSource(db, plan.sourceId);
          if ((current?.fingerprint || null) !== plan.review.previousFingerprint)
            throw new WeavaError('另一项导入已修改此来源，请重新预检。', 409);
          initialize(db);
          const importedAt = new Date().toISOString();
          db.prepare('INSERT INTO wp_statistics_snapshots VALUES(?,?,?,?,?,?,?)').run(
            plan.fingerprint,
            plan.sourceId,
            plan.contentHash,
            plan.capturedAt,
            importedAt,
            snapshotFile,
            JSON.stringify({
              source: snapshot.source,
              missingColumns: snapshot.missingColumns,
              inspection: inspectWordpressStatistics(snapshot),
              mapping: map.rows,
            }),
          );
          const insert = db.prepare('INSERT INTO wp_statistics_rows VALUES(?,?,?,?)');
          for (const table of tableNames)
            for (const row of snapshot.tables[table].rows)
              insert.run(plan.fingerprint, table, row.id, JSON.stringify(row));
          const page = db.prepare('INSERT INTO wp_statistics_page_map VALUES(?,?,?,?)');
          for (const row of map.rows) page.run(plan.fingerprint, row.id, row.path, row.entryId);
          db.prepare(
            'INSERT INTO wp_statistics_sources VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET fingerprint=excluded.fingerprint,content_hash=excluded.content_hash,captured_at=excluded.captured_at',
          ).run(plan.sourceId, plan.siteUrl, plan.fingerprint, plan.contentHash, plan.capturedAt);
          return { ...plan, changed: true, backup, archive: snapshotFile, importedAt };
        })
        .immediate();
      writeFileSync(
        join(archive, 'receipt-' + crypto.randomUUID() + '.json'),
        JSON.stringify(result, null, 2),
        { flag: 'wx' },
      );
      return result;
    } finally {
      db.close();
    }
  });
}
