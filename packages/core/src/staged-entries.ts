import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Entry } from '@weava/contracts';
import { WeavaError } from '../../contracts/src/errors.ts';
import { BoundedCache } from './cache.ts';

/** Two reusable disk workspaces bound import memory and avoid accumulating temporary files. */
export class EntryWorkspace {
  private db:Database.Database;
  private cache=new BoundedCache<string,any>(16,8*1024*1024);
  constructor(root:string){
    const directory=join(root,'cache','wxr');mkdirSync(directory,{recursive:true});
    let selected:Database.Database|undefined;
    for(const slot of [0,1]){
      const db=new Database(join(directory,'wxr-workspace-'+slot+'.sqlite'),{timeout:0});
      try{db.exec('PRAGMA locking_mode=EXCLUSIVE;PRAGMA cache_size=-8192;BEGIN EXCLUSIVE;CREATE TABLE IF NOT EXISTS staging(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id));DELETE FROM staging;COMMIT;BEGIN EXCLUSIVE;');selected=db;break;}
      catch(error:any){db.close();if(error.code!=='SQLITE_BUSY')throw error;}
    }
    if(!selected)throw new WeavaError('已有两份来源导入正在处理，请等待完成后重试。',429);
    this.db=selected;
  }
  record<T extends {id:string}>(kind:string,value:T,heavy:readonly (keyof T)[]):T{
    const data=JSON.stringify(value);this.db.prepare('INSERT OR REPLACE INTO staging VALUES(?,?,?)').run(kind,value.id,data);
    const light={...value};for(const key of heavy)delete light[key];
    const id=value.id;
    for(const key of heavy)Object.defineProperty(light,key,{enumerable:true,get:()=>this.read(kind,id)[key]});
    return light;
  }
  private read(kind:string,id:string){
    const key=kind+':'+id,cached=this.cache.get(key);if(cached)return cached;
    const row=this.db.prepare('SELECT data FROM staging WHERE kind=? AND id=?').get(kind,id) as {data:string};
    return this.cache.set(key,JSON.parse(row.data),row.data.length*2);
  }
  reset(){this.cache.clear();this.db.exec('DELETE FROM staging');}
  close(){this.cache.clear();try{this.db.exec('COMMIT');}finally{this.db.close();}}
}
/** Only this internal list can skip a second full-array schema clone during exchange. */
export class StagedEntries extends Array<Entry>{
  static get [Symbol.species](){return Array;}
  constructor(private workspace:EntryWorkspace){super();}
  append(entry:Entry){this.push(this.workspace.record('entry',entry,['document','blocks','source','compatibility']));}
}
