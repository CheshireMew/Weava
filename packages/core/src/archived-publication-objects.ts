import type Database from 'better-sqlite3';
import {openSync,readSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {inside} from '../../runtime-common/src/paths.ts';

/** Immutable archived bodies remain addressable by the same content hash. */
export function archivedPublicationObject(db:Database.Database,key:string):{data:string}|undefined {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='archived_publication_objects'").get())return;
  const location=db.prepare('SELECT archive_id,offset,bytes FROM archived_publication_objects WHERE key=?').get(key) as {archive_id:string;offset:number;bytes:number}|undefined;
  if(!location)return;
  const file=inside(join(dirname(db.name),'archives','history'),location.archive_id+'/objects.jsonl');
  const handle=openSync(file,'r'),buffer=Buffer.alloc(location.bytes);
  try {let count=0;while(count<buffer.length){const n=readSync(handle,buffer,count,buffer.length-count,location.offset+count);if(!n)throw new Error('历史归档正文不完整。');count+=n;}}
  finally{closeSync(handle);}
  const row=JSON.parse(buffer.toString('utf8'));
  const actual=createHash('sha256').update('{"kind":'+JSON.stringify(row.kind)+',"value":'+row.data+'}').digest('hex');
  if(row.key!==key||actual!==key)throw new Error('历史归档正文校验失败。');
  return {data:row.data};
}
