import {mediaIdentity} from './paths.ts';
import {join,relative} from 'node:path';
import {statSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import type {Site} from './site.ts';
import {walk} from '../../runtime-common/src/files.ts';
import {maintenanceReferences} from './maintenance-reference-cache.ts';
import {expireUploads,previewTemporaryCleanup} from './temporary-files.ts';
function localBytes(path:string):number {
  if(!existsSync(path))return 0;
  const stat=lstatSync(path);if(stat.isSymbolicLink())return 0;
  if(stat.isFile())return stat.size;
  return stat.isDirectory()?readdirSync(path).reduce((sum,name)=>sum+localBytes(join(path,name)),0):0;
}
/** Immediate metadata only. Historical references and directory trees are scanned separately. */
export function storageOverview(site:Site){
  const saved=site.store.state('storage-usage');
  const snapshot=saved?JSON.parse(saved):null;
  const physical=(name:string)=>['','-wal','-shm'].reduce((sum,ext)=>sum+(existsSync(join(site.root,name+ext))?statSync(join(site.root,name+ext)).size:0),0);
  const versions=site.store.raw.prepare('SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM revisions INDEXED BY revision_data_bytes').get() as {count:number;bytes:number};
  const releases=site.store.raw.prepare('SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM releases INDEXED BY release_data_bytes').get() as {count:number;bytes:number};
  const media=site.store.raw.prepare("SELECT COUNT(*) count,COALESCE(SUM(json_extract(data,'$.bytes')),0) bytes FROM media_list").get() as {count:number;bytes:number};
  return {uploadsBytes:0,logsBytes:0,importsBytes:0,publicationObjects:[],unreferenced:{count:0,bytes:0,files:[]},backups:[],media,
    ...snapshot?.usage,databaseBytes:physical('weava.sqlite'),analyticsBytes:physical('analytics.sqlite'),businessBytes:physical('business.sqlite'),versions,releases,
    temporary:previewTemporaryCleanup(site),pendingUploads:site.store.raw.prepare("SELECT id,name,size,offset,status FROM media_uploads WHERE status NOT IN ('complete','purged') ORDER BY expires LIMIT 100").all(),
    scan:{checkedAt:snapshot?.checkedAt??null}};
}
export function storageUsage(site: Site) {
  expireUploads(site);
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
    businessBytes:physical('business.sqlite'),
    temporary:previewTemporaryCleanup(site),
    pendingUploads:site.store.raw.prepare("SELECT id,name,size,offset,status FROM media_uploads WHERE status NOT IN ('complete','purged') ORDER BY expires LIMIT 100").all() as {id:string;name:string;size:number;offset:number;status:string}[],
    uploadsBytes:localBytes(join(site.root,'uploads')),
    logsBytes:localBytes(join(site.root,'logs')),
    importsBytes:localBytes(join(site.root,'imports')),
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
