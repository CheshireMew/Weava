import type Database from 'better-sqlite3';
import type { Entry,Release,Block } from '@weava/contracts';
import { entryMediaReferences,mediaReferencesIn } from './media-references.ts';
import { builtInLayouts } from './layouts.ts';
export function referenceSchema(db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS authored_media_refs(scope TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(scope,id,path));CREATE INDEX IF NOT EXISTS authored_media_path ON authored_media_refs(path,scope,id);
    CREATE TABLE IF NOT EXISTS authored_layout_edges(scope TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(scope,id,target));CREATE INDEX IF NOT EXISTS authored_layout_target ON authored_layout_edges(target,scope,id);
    CREATE TABLE IF NOT EXISTS revision_media_refs(revision INTEGER NOT NULL,path TEXT NOT NULL,PRIMARY KEY(revision,path));CREATE INDEX IF NOT EXISTS revision_media_path ON revision_media_refs(path,revision);
    CREATE TABLE IF NOT EXISTS publication_entry_media(release_id TEXT NOT NULL,entry_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(release_id,entry_id,path));CREATE INDEX IF NOT EXISTS publication_entry_media_path ON publication_entry_media(release_id,path,entry_id);
    CREATE TRIGGER IF NOT EXISTS reference_revision_delete AFTER DELETE ON revisions BEGIN DELETE FROM revision_media_refs WHERE revision=OLD.revision; END;
    CREATE TRIGGER IF NOT EXISTS reference_record_delete AFTER DELETE ON records BEGIN DELETE FROM authored_media_refs WHERE scope=OLD.scope AND id=OLD.id;DELETE FROM authored_layout_edges WHERE scope=OLD.scope AND id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS reference_release_delete AFTER DELETE ON releases BEGIN DELETE FROM publication_entry_media WHERE release_id=OLD.id; END;`);
}
export function indexAuthoredMedia(db:Database.Database,scope:string,id:string,value:any){
  if(!['entry','entry-trash','layout','settings'].includes(scope))return;
  db.prepare('DELETE FROM authored_media_refs WHERE scope=? AND id=?').run(scope,id);
  db.prepare('DELETE FROM authored_layout_edges WHERE scope=? AND id=?').run(scope,id);
  const insert=db.prepare('INSERT OR IGNORE INTO authored_media_refs VALUES(?,?,?)'),edge=db.prepare('INSERT OR IGNORE INTO authored_layout_edges VALUES(?,?,?)');
  for(const path of scope==='entry'||scope==='entry-trash'?entryMediaReferences(value):mediaReferencesIn(value))insert.run(scope,id,path);
  const blocks=(items:Block[])=>{for(const block of items){if(block.type==='shared'&&block.props.layoutId)edge.run(scope,id,block.props.layoutId);blocks(block.children??[]);}};
  if(scope==='entry'||scope==='entry-trash')edge.run(scope,id,value.template??(value.kind==='content'?'@type:'+value.type:'page'));
  if(scope==='settings')for(const target of Object.values(value.regions??{}))if(target)edge.run(scope,id,target);
  blocks(value.blocks??[]);
}
export function indexRevisionMedia(db:Database.Database,revision:number,entry:Entry){
  const insert=db.prepare('INSERT OR IGNORE INTO revision_media_refs VALUES(?,?)');for(const path of entryMediaReferences(entry))insert.run(revision,path);
}
export function indexPublishedMedia(db:Database.Database,release:Release){
  const insert=db.prepare('INSERT OR IGNORE INTO publication_entry_media VALUES(?,?,?)');
  for(const entry of release.entries)for(const path of entryMediaReferences(entry,release))insert.run(release.id,entry.id,path);
}
export function migrateMediaReferences(db:Database.Database){
  const stored=new Set((db.prepare("SELECT id FROM records WHERE scope='layout'").all() as {id:string}[]).map(row=>row.id));
  for(const layout of builtInLayouts)if(!stored.has(layout.id))indexAuthoredMedia(db,'layout',layout.id,layout);
  let after=0;
  for(;;){const rows=db.prepare("SELECT rowid n,scope,id,data FROM records WHERE scope IN ('entry','layout','settings') AND rowid>? ORDER BY rowid LIMIT 32").all(after) as {n:number;scope:string;id:string;data:string}[];if(!rows.length)break;for(const row of rows)indexAuthoredMedia(db,row.scope,row.id,JSON.parse(row.data));after=rows.at(-1)!.n;}
  updateRevisionReferences(db);
}
/** Raw importers can append revisions. Catch up once, never rescan old bodies per attachment. */
export function updateRevisionReferences(db:Database.Database){
  const cursor=Number((db.prepare("SELECT value FROM state WHERE key='media-reference-revision'").get() as {value:string}|undefined)?.value??0);
  let last=cursor;
  for(;;){const rows=db.prepare('SELECT revision,scope,data FROM revisions WHERE revision>? ORDER BY revision LIMIT 32').all(last) as {revision:number;scope:string;data:string}[];if(!rows.length)break;for(const row of rows){if(row.scope==='entry')indexRevisionMedia(db,row.revision,JSON.parse(row.data));last=row.revision;}}
  if(last!==cursor)db.prepare("INSERT INTO state VALUES('media-reference-revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(last));
}
