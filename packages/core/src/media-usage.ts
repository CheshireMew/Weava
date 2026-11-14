import { WeavaError } from '@weava/contracts';
import type { Storage } from './storage.ts';
import { updateRevisionReferences } from './media-reference-index.ts';
import { mediaIdentity } from './paths.ts';

export function mediaUsage(store: Storage, id: string) {
  const media = store.get('media', id);
  if (!media) throw new WeavaError('媒体不存在。', 404);
  const urls = new Set(
    [media.value.url, ...(media.value.derivatives ?? []).map((item: any) => item.url)].map(
      mediaIdentity,
    ),
  );
  const paths = [...urls],
    marks = paths.map(() => '?').join(','),
    db = store.raw;
  db.transaction(() => updateRevisionReferences(db))();
  const affected = `WITH RECURSIVE affected(id) AS (
    SELECT id FROM authored_media_refs WHERE scope='layout' AND path IN (${marks})
    UNION SELECT edge.id FROM authored_layout_edges edge JOIN affected a ON a.id=edge.target WHERE edge.scope='layout'
    UNION SELECT '@type:'||r.id FROM records r JOIN affected a ON a.id=COALESCE(json_extract(r.data,'$.template'),'article') WHERE r.scope='type'
  ) `;
  const global = !!db
    .prepare(
      affected +
        "SELECT 1 FROM authored_layout_edges WHERE scope='settings' AND target IN affected LIMIT 1",
    )
    .get(...paths);
  const working = db
    .prepare(
      affected +
        `SELECT l.id,json_extract(l.summary,'$.title') title,json_extract(l.summary,'$.path') path FROM entry_list l WHERE ? OR l.id IN (SELECT id FROM authored_media_refs WHERE scope='entry' AND path IN (${marks})) OR l.id IN (SELECT id FROM authored_layout_edges WHERE scope='entry' AND target IN affected) ORDER BY l.id`,
    )
    .all(...paths, global ? 1 : 0, ...paths) as { id: string; title: string; path: string }[];
  const releaseId = store.state('release');
  const publishedIds = releaseId
    ? (db
        .prepare(
          `SELECT DISTINCT entry_id FROM publication_entry_media WHERE release_id=? AND path IN (${marks})`,
        )
        .all(releaseId, ...paths) as { entry_id: string }[])
    : [];
  const published = publishedIds.length ? new Set(publishedIds.map((row) => row.entry_id)) : null;
  return {
    working,
    publishedIds: published ?? new Set<string>(),
    layouts: db
      .prepare(
        `SELECT r.id,json_extract(r.data,'$.label') label FROM records r WHERE r.scope='layout' AND r.id IN (SELECT id FROM authored_media_refs WHERE scope='layout' AND path IN (${marks})) ORDER BY r.id`,
      )
      .all(...paths) as { id: string; label: string }[],
    settings: !!db
      .prepare(
        `SELECT 1 FROM authored_media_refs WHERE scope='settings' AND path IN (${marks}) LIMIT 1`,
      )
      .get(...paths),
    historicalRevisions: (
      db
        .prepare(
          `SELECT COUNT(DISTINCT revision) n FROM revision_media_refs WHERE path IN (${marks})`,
        )
        .get(...paths) as { n: number }
    ).n,
  };
}
