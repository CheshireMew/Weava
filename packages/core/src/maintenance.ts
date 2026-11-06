import {mediaIdentity} from './paths.ts';
import {join,relative} from 'node:path';
import {statSync,existsSync} from 'node:fs';
import type {Site} from './site.ts';
import {walk} from '../../runtime-common/src/files.ts';
import {maintenanceReferences} from './maintenance-reference-cache.ts';
export function storageUsage(site: Site) {
  const refs = maintenanceReferences(site);
  for (const row of site.store.list('media'))
    if (refs.has(mediaIdentity(row.value.url)))
      for (const derivative of row.value.derivatives ?? [])
        if (derivative.url) refs.add(mediaIdentity(derivative.url));
  const media = walk(join(site.root, 'media')).map((file) => ({
    path: '/media/' + relative(join(site.root, 'media'), file).replaceAll('\\', '/'),
    bytes: statSync(file).size,
  }));
  const unused = media.filter((file) => !refs.has(mediaIdentity(file.path)));
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
      'SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM revisions INDEXED BY revision_data_bytes',
    )
    .get();
  const releases = site.store.raw
    .prepare(
      'SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM releases INDEXED BY release_data_bytes',
    )
    .get();
  return {
    databaseBytes: physical('weava.sqlite'),
    analyticsBytes: physical('analytics.sqlite'),
    versions: versions as {count:number;bytes:number},
    releases: releases as {count:number;bytes:number},
    publicationObjects: site.store.raw.prepare('SELECT kind,COUNT(*) count,SUM(LENGTH(CAST(data AS BLOB))) bytes FROM publication_objects INDEXED BY publication_object_bytes GROUP BY kind').all() as {kind:string;count:number;bytes:number}[],
    media: { count: media.length, bytes: media.reduce((sum, f) => sum + f.bytes, 0) },
    unreferenced: {
      count: unused.length,
      bytes: unused.reduce((sum, f) => sum + f.bytes, 0),
      files: unused.slice(0, 50),
    },
    backups,
  };
}
