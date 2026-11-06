import { resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { digest } from '../../../runtime-common/src/identity.ts';
import {
  WordpressStatisticsSnapshot,
  stable,
  readWordpressStatistics,
  inspectWordpressStatistics,
} from './format.ts';
import { database, pagePath, activeSource } from './store.ts';

export function mappings(root: string, snapshot: WordpressStatisticsSnapshot) {
  const db = database(root, 'weava.sqlite');
  try {
    const entries = db.prepare("SELECT id,data FROM records WHERE scope='entry'").all() as {
      id: string;
      data: string;
    }[];
    const paths = new Map<string, string>(),
      postIds = new Map<string, string>(),
      targetPaths = new Map<string, string>();
    for (const row of entries) {
      const entry = JSON.parse(row.data);
      paths.set(entry.path, row.id);
      targetPaths.set(row.id, entry.path);
      if (entry.source?.system === 'wordpress' && entry.source.id != null) {
        const origin = entry.source.originalUrl;
        if (
          origin &&
          new URL(origin, snapshot.source.siteUrl).origin !==
            new URL(snapshot.source.siteUrl).origin
        )
          continue;
        postIds.set(String(entry.source.id), row.id);
      }
    }
    const mapped = snapshot.tables.pages.rows.map((row) => {
      const path = pagePath(row.uri);
      return {
        id: row.id,
        uri: row.uri,
        path,
        entryId:
          (row.type === 'post' || row.type === 'page'
            ? postIds.get(String(row.objectId))
            : undefined) ||
          (path ? paths.get(path) : undefined) ||
          null,
      };
    });
    return {
      rows: mapped,
      hash: digest(
        stable(
          mapped.map((row) => ({
            ...row,
            targetPath: row.entryId ? targetPaths.get(row.entryId) || null : null,
          })),
        ),
      ),
      matched: mapped.filter((r) => r.entryId).length,
      unmatched: mapped
        .filter((r) => !r.entryId)
        .map((r) => r.uri)
        .filter((value, index, all) => all.indexOf(value) === index)
        .sort(),
    };
  } finally {
    db.close();
  }
}

export function planWordpressStatistics(input: string, target: string) {
  const root = resolve(target),
    snapshot = readWordpressStatistics(input),
    info = inspectWordpressStatistics(snapshot),
    map = mappings(root, snapshot);
  const db = database(root, 'analytics.sqlite');
  let previous: any, native: any, baselines: any;
  try {
    previous = activeSource(db, info.sourceId);
    native = db.prepare('SELECT kind,COUNT(*) count FROM events GROUP BY kind').all();
    baselines = db
      .prepare(
        'SELECT source_id,COUNT(*) entries,SUM(views) views FROM historical_views GROUP BY source_id',
      )
      .all();
  } finally {
    db.close();
  }
  const unchanged = previous?.content_hash === info.contentHash;
  if (previous && !unchanged && previous.captured_at >= info.capturedAt)
    throw new WeavaError('来源快照比已导入版本旧，或同一采集时间内容冲突。', 409);
  const action = unchanged ? 'unchanged' : previous ? 'replace-source-snapshot' : 'import';
  const review = {
    version: 1,
    target: root,
    sourceId: info.sourceId,
    fingerprint: info.fingerprint,
    contentHash: info.contentHash,
    previousFingerprint: previous?.fingerprint || null,
    mappingHash: map.hash,
  };
  return {
    schema: 'weava-wp-statistics-plan-v1',
    ...info,
    target: root,
    action,
    canApply: true,
    mapping: { matched: map.matched, total: map.rows.length, unmatched: map.unmatched },
    existing: { source: previous || null, nativeEvents: native, independentCounters: baselines },
    review: { ...review, token: digest(stable(review)) },
    warnings: [
      ...(map.unmatched.length ? ['部分网址未映射到内容，仍保留原网址和统计。'] : []),
      ...(baselines.length
        ? ['导入后日常统计和文章浏览量采用 WP Statistics；原有独立计数器保留，不重复叠加。']
        : []),
    ],
  };
}
