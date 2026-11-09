import Database from 'better-sqlite3';
import {mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Site} from './site.ts';
import {jsonLines} from './file-io.ts';

/** A rebuildable summary index: browsing never verifies or materializes the archive payload. */
export function historyDirectory(site:Site,id:string,folder:string,hash:string,options:{page?:number;pageSize?:number}) {
  const cache=join(site.root,'cache');mkdirSync(cache,{recursive:true});
  const db=new Database(join(cache,'history-directory.sqlite'));
  try {
    db.pragma('busy_timeout=5000');
    db.exec('CREATE TABLE IF NOT EXISTS archives(id TEXT PRIMARY KEY,hash TEXT,used INTEGER); CREATE TABLE IF NOT EXISTS items(archive TEXT,kind TEXT,ordinal INTEGER,data TEXT,PRIMARY KEY(archive,kind,ordinal));');
    db.transaction(()=>{
      const existing=db.prepare('SELECT hash FROM archives WHERE id=?').get(id) as {hash:string}|undefined;
      if(existing?.hash!==hash){
        db.prepare('DELETE FROM items WHERE archive=?').run(id);
        const insert=db.prepare('INSERT INTO items VALUES(?,?,?,?)');
        const directory=join(folder,'directory.jsonl');
        if(existsSync(directory)){
          const ordinal:Record<string,number>={releases:0,revisions:0};
          for(const {kind,...summary} of jsonLines(directory))if(kind==='releases'||kind==='revisions')insert.run(id,kind,ordinal[kind]++,JSON.stringify(summary));
        }else for(const kind of ['releases','revisions']){
          let ordinal=0;
          for(const row of jsonLines(join(folder,kind+'.jsonl'))){
            const summary=kind==='releases'?{id:row.id,createdAt:row.created_at}:{revision:row.revision,id:row.id,scope:row.scope,createdAt:row.created_at,label:row.label};
            insert.run(id,kind,ordinal++,JSON.stringify(summary));
          }
        }
      }
      db.prepare('INSERT OR REPLACE INTO archives VALUES(?,?,?)').run(id,hash,Date.now());
      db.exec('DELETE FROM items WHERE archive IN (SELECT id FROM archives ORDER BY used DESC LIMIT -1 OFFSET 8);DELETE FROM archives WHERE id NOT IN (SELECT id FROM archives ORDER BY used DESC LIMIT 8);');
    }).immediate();
    const count=db.prepare('SELECT COUNT(*) n FROM items WHERE archive=? AND kind=?');
    const totalReleases=(count.get(id,'releases') as {n:number}).n,totalRevisions=(count.get(id,'revisions') as {n:number}).n;
    const pageSize=Math.min(100,Math.max(1,options.pageSize??50)),pages=Math.max(1,Math.ceil(Math.max(totalReleases,totalRevisions)/pageSize)),page=Math.min(pages,Math.max(1,options.page??1));
    const read=(kind:string)=>(db.prepare('SELECT data FROM items WHERE archive=? AND kind=? ORDER BY ordinal LIMIT ? OFFSET ?').all(id,kind,pageSize,(page-1)*pageSize) as {data:string}[]).map(row=>JSON.parse(row.data));
    return {id,page,pageSize,pages,totalReleases,totalRevisions,releases:read('releases'),revisions:read('revisions')};
  } finally {db.close();}
}
