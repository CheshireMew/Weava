import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statfsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { atomic, json, hash, inside, noDirectoryLink } from './state.ts';

export interface RecoveryRecord {
  version: 1;
  kind: 'migration-recovery';
  root: string;
  entries: {path:string;hash:string}[];
  absent: string[];
  createdAt: string;
}
export function assertSpace(folder:string,required:number) {
  let base=resolve(folder);
  while(!existsSync(base)&&dirname(base)!==base)base=dirname(base);
  const fs=statfsSync(base);
  if(fs.bavail*fs.bsize<required+512*1024*1024)throw new Error('恢复与迁移工作所需空间不足，已停止操作。');
}
export function authoredFingerprint(root:string,preservedAccountKeys?:string[]) {
  const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});
  const digest=(name:string,query:string)=>hash(JSON.stringify(db.prepare(query).all()));
  try {
    return {
      records:digest('records',"SELECT scope,id,revision,data FROM records WHERE scope IN ('entry','settings','type','term','layout','media') ORDER BY scope,id"),
      history:digest('history',"SELECT revision,scope,id,data FROM revisions WHERE scope IN ('entry','settings','type','term','layout','media') ORDER BY revision"),
      publication:digest('publication',"SELECT key,value FROM state WHERE key='release'"),
      account:Object.fromEntries((db.prepare("SELECT key,value FROM state WHERE key LIKE 'owner%' OR key='engagement-secret' ORDER BY key").all() as {key:string;value:string}[]).filter(row=>!preservedAccountKeys||preservedAccountKeys.includes(row.key)).map(row=>[row.key,hash(row.value)])),
      comments:db.prepare("SELECT 1 FROM sqlite_master WHERE name='article_comments'").get()?digest('comments',"SELECT * FROM article_comments ORDER BY id"):hash('[]'),
      keys:['cli-token','account.key'].map(name=>existsSync(join(root,name))?hash(readFileSync(join(root,name))):null),
    };
  } finally {db.close();}
}
export function validateRecovery(folder:string,root:string):RecoveryRecord {
  const value=json<RecoveryRecord>(join(folder,'recovery.json'));
  if(value.version!==1||value.root!==resolve(root)||value.kind!=='migration-recovery'||!Array.isArray(value.entries))throw new Error('恢复点不属于该网站。');
  noDirectoryLink(folder);noDirectoryLink(root);
  for(const e of value.entries)if(hash(readFileSync(inside(folder,e.path)))!==e.hash)throw new Error('恢复点校验失败：'+e.path);
  return value;
}
export function recoverFiles(folder:string,root:string) {
  const m=validateRecovery(folder,root);
  const journalFile=join(folder,'restore.json');
  const journal=existsSync(journalFile)?json(journalFile):{version:1,id:randomUUID(),status:'restoring',moved:[] as string[],restored:[] as string[]};
  if(journal.status==='complete')return {restored:true,reused:true};
  // Moving failed live files must stay on the site's volume, even when its
  // recovery point is on another disk. Keep the destination in the journal.
  const retained=journal.retained??join(dirname(resolve(root)),'.weava-recovery-'+basename(root)+'-'+journal.id);
  if(journal.retained&&resolve(journal.retained)!==join(dirname(resolve(root)),'.weava-recovery-'+basename(root)+'-'+journal.id))throw new Error('恢复保留目录不属于该网站。');
  noDirectoryLink(dirname(retained));
  if(existsSync(retained))noDirectoryLink(retained);
  journal.retained=retained;
  const members=[...new Set([...m.entries.map(e=>e.path),...m.absent,...['weava.sqlite-wal','weava.sqlite-shm','analytics.sqlite-wal','analytics.sqlite-shm','business.sqlite-wal','business.sqlite-shm']])];
  mkdirSync(retained,{recursive:true});atomic(journalFile,journal);
  for(const member of members) {
    const source=inside(root,member),dest=inside(retained,member);
    if(!journal.moved.includes(member)) {
      if(existsSync(source)&&!existsSync(dest)){mkdirSync(dirname(dest),{recursive:true});renameSync(source,dest);}
      journal.moved.push(member);atomic(journalFile,journal);
    }
  }
  for(const e of m.entries) {
    const destination=inside(root,e.path);
    if(!journal.restored.includes(e.path)||!existsSync(destination)||hash(readFileSync(destination))!==e.hash) {
      mkdirSync(dirname(destination),{recursive:true});
      const temp=destination+'.restoring-'+journal.id;
      writeFileSync(temp,readFileSync(inside(folder,e.path)));renameSync(temp,destination);
      journal.restored.push(e.path);atomic(journalFile,journal);
    }
  }
  journal.status='complete';atomic(journalFile,journal);
  return {restored:true,retained};
}
