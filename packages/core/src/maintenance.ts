import { join, relative } from 'node:path';
import { statSync, existsSync, readFileSync } from 'node:fs';
import type { Site } from './site.ts';
import { walk } from './storage.ts';
export function storageUsage(site: Site) {
  const refs = new Set<string>();
  const collect = (source: string) => { for (const match of source.matchAll(/\/media\/[^"'<>\\\s)]+/g)) try { refs.add(decodeURIComponent(match[0])); } catch {} };
  for (const table of ['records', 'revisions', 'releases', 'publication_objects'])
    for (const row of site.store.raw.prepare(`SELECT data FROM ${table}${['records','revisions'].includes(table) ? " WHERE scope NOT IN ('media','history-archive')" : ''}`).iterate() as Iterable<{
      data: string;
    }>) {
      collect(row.data);
    }
  for (const file of walk(join(site.root,'archives','history'))) if (/\.jsonl$/.test(file)) collect(readFileSync(file,'utf8'));
  for (const row of site.store.list('media'))
    if (refs.has(row.value.url))
      for (const derivative of row.value.derivatives ?? [])
        if (derivative.url) refs.add(derivative.url);
  const media = walk(join(site.root, 'media')).map((file) => ({
    path: '/media/' + relative(join(site.root, 'media'), file).replaceAll('\\', '/'),
    bytes: statSync(file).size,
  }));
  const unused = media.filter((file) => !refs.has(file.path));
  const backups: any[] = [];
  for (const row of site.store.raw
    .prepare("SELECT data FROM jobs WHERE operation='backup' AND status='complete'")
    .all() as any[]) {
    const job = JSON.parse(row.data),
      path = job.result?.path;
    if (path && existsSync(path))
      backups.push({ path, bytes: walk(path).reduce((sum, file) => sum + statSync(file).size, 0) });
  }
  const physical = (name: string) =>
    ['', '-wal', '-shm'].reduce(
      (sum, ext) =>
        sum +
        (existsSync(join(site.root, name + ext)) ? statSync(join(site.root, name + ext)).size : 0),
      0,
    );
  const versions = site.store.raw
    .prepare(
      'SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM revisions',
    )
    .get();
  const releases = site.store.raw
    .prepare(
      'SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM releases',
    )
    .get();
  return {
    databaseBytes: physical('weava.sqlite'),
    analyticsBytes: physical('analytics.sqlite'),
    versions,
    releases,
    publicationObjects: site.store.raw.prepare('SELECT kind,COUNT(*) count,SUM(LENGTH(CAST(data AS BLOB))) bytes FROM publication_objects GROUP BY kind').all(),
    media: { count: media.length, bytes: media.reduce((sum, f) => sum + f.bytes, 0) },
    unreferenced: {
      count: unused.length,
      bytes: unused.reduce((sum, f) => sum + f.bytes, 0),
      files: unused.slice(0, 50),
    },
    backups,
  };
}
