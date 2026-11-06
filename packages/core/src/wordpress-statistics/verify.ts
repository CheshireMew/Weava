import { join, resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { database, hasHistory } from './store.ts';
import {
  readWordpressStatistics,
  metadata,
  tableNames,
  stable,
  inspectWordpressStatistics,
} from './format.ts';

export function wordpressStatisticsSources(root: string) {
  const db = database(resolve(root), 'analytics.sqlite');
  try {
    return hasHistory(db)
      ? db.prepare('SELECT * FROM wp_statistics_sources ORDER BY site_url').all()
      : [];
  } finally {
    db.close();
  }
}

export function verifyWordpressStatistics(root: string, sourceId?: string) {
  const target = resolve(root),
    db = database(target, 'analytics.sqlite');
  try {
    if (!hasHistory(db)) throw new WeavaError('尚未导入 WP Statistics。', 404);
    const sources = db
      .prepare('SELECT * FROM wp_statistics_sources ORDER BY site_url')
      .all() as any[];
    const selected = sourceId ? sources.filter((s) => s.source_id === sourceId) : sources;
    if (!selected.length) throw new WeavaError('统计来源不存在。', 404);
    const verified = selected.map((active) => {
      const snapshotFile = join(
          target,
          'imports',
          'wp-statistics',
          active.fingerprint,
          'snapshot.json',
        ),
        snapshot = readWordpressStatistics(snapshotFile),
        info = metadata(snapshot);
      if (
        info.fingerprint !== active.fingerprint ||
        info.contentHash !== active.content_hash ||
        info.capturedAt !== active.captured_at
      )
        throw new WeavaError('快照归档与来源记录不一致。');
      const stored = db
        .prepare('SELECT * FROM wp_statistics_snapshots WHERE fingerprint=?')
        .get(active.fingerprint) as any;
      if (
        !stored ||
        stored.source_id !== active.source_id ||
        stored.content_hash !== active.content_hash
      )
        throw new WeavaError('快照登记不一致。');
      for (const name of tableNames) {
        const rows = (
          db
            .prepare(
              'SELECT data FROM wp_statistics_rows WHERE fingerprint=? AND table_name=? ORDER BY row_id',
            )
            .all(active.fingerprint, name) as { data: string }[]
        ).map((r) => JSON.parse(r.data));
        if (stable(rows) !== stable([...snapshot.tables[name].rows].sort((a, b) => a.id - b.id)))
          throw new WeavaError('已导入的来源表校验失败：' + name);
      }
      const mapped = (
        db
          .prepare(
            'SELECT page_id FROM wp_statistics_page_map WHERE fingerprint=? ORDER BY page_id',
          )
          .all(active.fingerprint) as { page_id: number }[]
      ).map((r) => r.page_id);
      if (
        stable(mapped) !== stable(snapshot.tables.pages.rows.map((r) => r.id).sort((a, b) => a - b))
      )
        throw new WeavaError('页面映射记录不完整。');
      const pageUris = new Map(snapshot.tables.pages.rows.map((row) => [row.id, row.uri]));
      const mappedRows = (
        db
          .prepare(
            'SELECT page_id id,path,entry_id entryId FROM wp_statistics_page_map WHERE fingerprint=? ORDER BY page_id',
          )
          .all(active.fingerprint) as any[]
      ).map((row) => ({
        ...row,
        uri: pageUris.get(row.id),
      }));
      const mapping = JSON.parse(stored.metadata).mapping;
      if (
        !Array.isArray(mapping) ||
        stable(mappedRows) !== stable([...mapping].sort((a, b) => a.id - b.id))
      )
        throw new WeavaError('页面映射内容校验失败。');
      return {
        sourceId: active.source_id,
        fingerprint: active.fingerprint,
        archive: snapshotFile,
        counts: inspectWordpressStatistics(snapshot).counts,
      };
    });
    return { ok: true, sources: verified };
  } finally {
    db.close();
  }
}
