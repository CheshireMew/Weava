import type Database from 'better-sqlite3';
import type { Release } from '@weava/contracts';
import { entryCover } from './entry-cover.ts';
export function listIndexSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS entry_list(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,summary TEXT NOT NULL,fields TEXT NOT NULL,kind TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,visibility TEXT NOT NULL,title TEXT NOT NULL,search TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entry_list_kind_type ON entry_list(kind,type,status,visibility);
    CREATE INDEX IF NOT EXISTS entry_list_title ON entry_list(title COLLATE NOCASE,id);
    CREATE INDEX IF NOT EXISTS entry_list_updated ON entry_list(updated_at,id);
    CREATE TABLE IF NOT EXISTS published_entry_revisions(release_id TEXT NOT NULL,entry_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(release_id,entry_id));
    CREATE TABLE IF NOT EXISTS media_list(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL,search TEXT NOT NULL,kind TEXT NOT NULL,archived INTEGER NOT NULL,group_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS media_list_filters ON media_list(archived,kind,group_id,created_at DESC,id);`);
}
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase();
export function indexListRecord(db:Database.Database,scope:string,id:string,value:any,revision:number,updatedAt:string) {
  if(scope==='entry'){
    const {document,blocks,compatibility,fields,source,...summary}=value;
    summary.visibility??='public';
    const type=db.prepare("SELECT data FROM records WHERE scope='type' AND id=?").get(value.type??'post') as {data:string}|undefined;
    summary.cover=entryCover(value,type?JSON.parse(type.data):undefined);
    db.prepare(`INSERT INTO entry_list VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,summary=excluded.summary,fields=excluded.fields,kind=excluded.kind,type=excluded.type,status=excluded.status,visibility=excluded.visibility,title=excluded.title,search=excluded.search,updated_at=excluded.updated_at,published_at=excluded.published_at`)
      .run(id,revision,JSON.stringify(summary),JSON.stringify(fields??{}),value.kind,value.type??'post',value.status,summary.visibility,summary.title,normalized(summary.title+' '+(summary.description??'')),updatedAt,value.publishedAt??'');
  }
  if(scope==='type'){
    for(const row of db.prepare("SELECT id,data,revision,updated_at FROM records WHERE scope='entry' AND json_extract(data,'$.type')=?").all(id) as {id:string;data:string;revision:number;updated_at:string}[])
      indexListRecord(db,'entry',row.id,JSON.parse(row.data),row.revision,row.updated_at);
  }
  if(scope==='media'){
    const kind=/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(value.url)?'image':/\.(mp4|webm)$/i.test(value.url)?'video':/\.mp3$/i.test(value.url)?'audio':'file';
    db.prepare(`INSERT INTO media_list VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,search=excluded.search,kind=excluded.kind,archived=excluded.archived,group_id=excluded.group_id,created_at=excluded.created_at,updated_at=excluded.updated_at`)
      .run(id,revision,JSON.stringify(value),normalized(value.name??''),kind,value.archived?1:0,value.groupId??null,value.createdAt??'',updatedAt);
  }
}
export function indexPublishedRevisions(db:Database.Database,release:Release){
  const insert=db.prepare('INSERT OR REPLACE INTO published_entry_revisions VALUES(?,?,?)');
  for(const entry of release.entries)insert.run(release.id,entry.id,entry.revisionId??0);
}
export function migrateListRecords(db:Database.Database){
  for(const row of db.prepare("SELECT scope,id,data,revision,updated_at FROM records WHERE scope IN ('entry','media')").all() as {scope:string;id:string;data:string;revision:number;updated_at:string}[])indexListRecord(db,row.scope,row.id,JSON.parse(row.data),row.revision,row.updated_at);
}
