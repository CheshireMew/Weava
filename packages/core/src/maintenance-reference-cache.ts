import Database from 'better-sqlite3';
import {mkdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import type {Site} from './site.ts';
import {walk} from '../../runtime-common/src/files.ts';
import {mediaReferencesIn} from './media-references.ts';
import {jsonLines} from './file-io.ts';

/** Derived, rebuildable cache; unchanged history is never read into JS again. */
export function maintenanceReferences(site:Site){
  const folder=join(site.root,'cache');mkdirSync(folder,{recursive:true});
  const db=new Database(join(folder,'maintenance.sqlite'));
  try{
    db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');
    db.exec('CREATE TABLE IF NOT EXISTS sources(kind TEXT,id TEXT,stamp TEXT,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS refs(kind TEXT,id TEXT,path TEXT,PRIMARY KEY(kind,id,path),FOREIGN KEY(kind,id) REFERENCES sources(kind,id) ON DELETE CASCADE);');
    db.prepare('ATTACH DATABASE ? AS content').run(join(site.root,'weava.sqlite'));
    const source=db.prepare('INSERT INTO sources VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET stamp=excluded.stamp'),remove=db.prepare('DELETE FROM refs WHERE kind=? AND id=?'),insert=db.prepare('INSERT OR IGNORE INTO refs VALUES(?,?,?)');
    const put=(kind:string,id:string,stamp:string,paths:Iterable<string>)=>{source.run(kind,id,stamp);remove.run(kind,id);for(const path of paths)insert.run(kind,id,path);};
    for(const [kind,id,stamp,condition] of [
      ['records',"s.scope||':'||s.id",'CAST(s.revision AS TEXT)',"s.scope NOT IN ('media','history-archive')"],
      ['revisions','CAST(s.revision AS TEXT)','CAST(s.revision AS TEXT)',"s.scope NOT IN ('media','history-archive')"],
      ['releases','s.id','s.id','1=1'],['publication_objects','s.key','s.key','1=1'],
    ]){
      let after=0;
      for(;;){
        const rows=db.prepare(`SELECT s.rowid n,${id} id,${stamp} stamp,s.data FROM content.${kind} s LEFT JOIN sources c ON c.kind=? AND c.id=${id} WHERE s.rowid>? AND (${condition}) AND (c.stamp IS NULL OR c.stamp<>${stamp}) ORDER BY s.rowid LIMIT 64`).all(kind,after) as {n:number;id:string;stamp:string;data:string}[];
        if(!rows.length)break;
        db.transaction(()=>{for(const row of rows)put(kind,row.id,row.stamp,mediaReferencesIn(row.data));}).immediate();after=rows.at(-1)!.n;
      }
      db.prepare(`DELETE FROM sources WHERE kind=? AND id NOT IN(SELECT ${id} FROM content.${kind} s WHERE ${condition})`).run(kind);
    }
    const archives=walk(join(site.root,'archives','history')).filter(file=>/\.jsonl$/.test(file)),known=new Set(archives);
    for(const file of archives){const info=statSync(file),stamp=info.size+':'+info.mtimeMs,old=db.prepare("SELECT stamp FROM sources WHERE kind='archive' AND id=?").get(file) as {stamp:string}|undefined;if(old?.stamp===stamp)continue;
      db.transaction(()=>{source.run('archive',file,stamp);remove.run('archive',file);for(const row of jsonLines(file))for(const path of mediaReferencesIn(typeof row.data==='string'?row.data:JSON.stringify(row)))insert.run('archive',file,path);}).immediate();
    }
    for(const row of db.prepare("SELECT id FROM sources WHERE kind='archive'").all() as {id:string}[])if(!known.has(row.id))db.prepare("DELETE FROM sources WHERE kind='archive' AND id=?").run(row.id);
    return new Set((db.prepare('SELECT DISTINCT path FROM refs').all() as {path:string}[]).map(row=>row.path));
  }finally{db.close();}
}
