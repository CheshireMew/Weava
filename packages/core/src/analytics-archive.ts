import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,statSync,statfsSync} from 'node:fs';
import {join} from 'node:path';
import {WeavaError} from '@weava/contracts';
import {digestFile} from './file-io.ts';
import {validDay} from './analytics-dates.ts';
export function analyticsArchiveSchema(db:Database.Database){db.exec(`
  CREATE TABLE IF NOT EXISTS analytics_archives(id TEXT PRIMARY KEY,path TEXT NOT NULL,created_at TEXT NOT NULL,before_date TEXT NOT NULL,review TEXT NOT NULL UNIQUE,hash TEXT NOT NULL,bytes INTEGER NOT NULL,events INTEGER NOT NULL,views INTEGER NOT NULL,clicks INTEGER NOT NULL,restored_at TEXT);
  CREATE TABLE IF NOT EXISTS analytics_archive_days(archive_id TEXT NOT NULL,day TEXT NOT NULL,path TEXT NOT NULL,views INTEGER NOT NULL,clicks INTEGER NOT NULL,visitors INTEGER NOT NULL,sessions INTEGER NOT NULL,PRIMARY KEY(archive_id,day,path));
  CREATE TABLE IF NOT EXISTS analytics_archive_visitors(archive_id TEXT NOT NULL,day TEXT NOT NULL,path TEXT NOT NULL,visitor_key TEXT NOT NULL,PRIMARY KEY(archive_id,day,path,visitor_key));
  CREATE TABLE IF NOT EXISTS analytics_archive_sessions(archive_id TEXT NOT NULL,day TEXT NOT NULL,path TEXT NOT NULL,visitor_key TEXT NOT NULL,session_key TEXT NOT NULL,PRIMARY KEY(archive_id,day,path,visitor_key,session_key));
`);}
const selections=[
  ['events','SELECT * FROM events WHERE ts<? ORDER BY id'],
  ['event_context','SELECT c.* FROM event_context c JOIN events e ON e.id=c.event_id WHERE e.ts<? ORDER BY c.event_id'],
  ['page_activity','SELECT a.* FROM page_activity a JOIN events e ON e.id=a.view_id WHERE e.ts<? ORDER BY a.view_id'],
] as const;
export function previewAnalyticsArchive(db:Database.Database,before:string,clock=Date.now()){
  if(!validDay(before)||Date.parse(before+'T00:00:00Z')>clock-86400000)throw new WeavaError('归档截止日期使用 UTC，至少保留最近 24 小时明细。');
  const cutoff=before+'T00:00:00.000Z',hash=createHash('sha256');hash.update(cutoff);
  let payloadBytes=0;const counts:Record<string,number>={};
  for(const [table,sql] of selections){let count=0;hash.update(table);for(const row of db.prepare(sql).iterate(cutoff)){const value=JSON.stringify(row);payloadBytes+=Buffer.byteLength(value);hash.update(value);count++;}counts[table]=count;}
  const totals=db.prepare("SELECT COALESCE(SUM(kind='view'),0) views,COALESCE(SUM(kind='click'),0) clicks FROM events WHERE ts<?").get(cutoff) as {views:number;clicks:number};
  return {before,cutoff,review:hash.digest('hex'),events:counts.events,context:counts.event_context,activity:counts.page_activity,views:totals.views,clicks:totals.clicks,estimatedBytes:payloadBytes*2+65536};
}
export function archiveAnalytics(db:Database.Database,root:string,before:string,review:string,budgetBytes=1073741824){
  const previous=db.prepare('SELECT id,path,bytes,events,views,clicks FROM analytics_archives WHERE review=? AND restored_at IS NULL').get(review) as {id:string;path:string;bytes:number;events:number;views:number;clicks:number}|undefined;
  if(previous)return {...previous,path:join(root,'archives','analytics',previous.id+'.sqlite')};
  const folder=join(root,'archives','analytics');mkdirSync(folder,{recursive:true});
  const id=randomUUID(),path=join(folder,id+'.sqlite');
  return db.transaction(()=>{
    const plan=previewAnalyticsArchive(db,before);
    if(plan.review!==review)throw new WeavaError('待归档明细已变化，请重新预检。',409);
    if(!plan.events)throw new WeavaError('这个日期之前没有可归档明细。');
    if(plan.estimatedBytes>budgetBytes)throw new WeavaError('预计归档体积超过本次预算，请缩小日期范围或明确提高预算。');
    const disk=statfsSync(root);if(disk.bavail*disk.bsize<plan.estimatedBytes+67108864)throw new WeavaError('磁盘空间不足，未开始归档。',507);
    const archive=new Database(path);
    try{
      archive.prepare('ATTACH DATABASE ? AS source').run(join(root,'analytics.sqlite'));
      archive.transaction(()=>{for(const [table,sql] of selections)archive.prepare('CREATE TABLE '+table+' AS '+sql.replaceAll(/\b(events|event_context|page_activity)\b/g,'source.$1')).run(plan.cutoff);archive.exec('CREATE TABLE metadata(version INTEGER,before_date TEXT,review TEXT);');archive.prepare('INSERT INTO metadata VALUES(1,?,?)').run(before,review);})();
      archive.exec('DETACH DATABASE source');if(archive.pragma('integrity_check',{simple:true})!=='ok')throw new WeavaError('归档文件完整性校验失败。');
    }finally{archive.close();}
    const hash=digestFile(path),bytes=statSync(path).size,createdAt=new Date().toISOString();
    db.prepare('INSERT INTO analytics_archive_days SELECT ?,substr(ts,1,10),path,SUM(kind=\'view\'),SUM(kind=\'click\'),COUNT(DISTINCT CASE WHEN kind=\'view\' THEN COALESCE(NULLIF(visitor,\'\'),id) END),COUNT(DISTINCT CASE WHEN kind=\'view\' THEN json_array(COALESCE(NULLIF(visitor,\'\'),id),COALESCE(NULLIF(session,\'\'),id)) END) FROM events WHERE ts<? GROUP BY substr(ts,1,10),path').run(id,plan.cutoff);
    for(const scope of ["''",'path']){
      db.prepare(`INSERT OR IGNORE INTO analytics_archive_visitors SELECT ?,substr(ts,1,10),${scope},COALESCE(NULLIF(visitor,''),id) FROM events WHERE ts<? AND kind='view' GROUP BY 2,3,4`).run(id,plan.cutoff);
      db.prepare(`INSERT OR IGNORE INTO analytics_archive_sessions SELECT ?,substr(ts,1,10),${scope},COALESCE(NULLIF(visitor,''),id),COALESCE(NULLIF(session,''),id) FROM events WHERE ts<? AND kind='view' GROUP BY 2,3,4,5`).run(id,plan.cutoff);
    }
    db.prepare('DELETE FROM event_context WHERE event_id IN (SELECT id FROM events WHERE ts<?)').run(plan.cutoff);
    db.prepare('DELETE FROM page_activity WHERE view_id IN (SELECT id FROM events WHERE ts<?)').run(plan.cutoff);
    db.prepare('DELETE FROM events WHERE ts<?').run(plan.cutoff);
    db.prepare('INSERT INTO analytics_archives VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run(id,path,createdAt,before,review,hash,bytes,plan.events,plan.views,plan.clicks);
    return {id,path,bytes,events:plan.events,views:plan.views,clicks:plan.clicks};
  }).immediate();
}
export function listAnalyticsArchives(db:Database.Database){return db.prepare('SELECT id,path,created_at createdAt,before_date before,bytes,events,views,clicks,restored_at restoredAt FROM analytics_archives ORDER BY created_at DESC').all() as {id:string;path:string;createdAt:string;before:string;bytes:number;events:number;views:number;clicks:number;restoredAt:string|null}[];}
export function archivedLifetime(db:Database.Database,path:string){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_archives'").get())return null;
  const totals=db.prepare('SELECT COALESCE(SUM(d.views),0) views,COALESCE(SUM(d.clicks),0) clicks FROM analytics_archive_days d JOIN analytics_archives a ON a.id=d.archive_id WHERE a.restored_at IS NULL'+(path?' AND d.path=?':'')).get(...(path?[path]:[])) as {views:number;clicks:number};
  const visitors=(db.prepare('SELECT COUNT(*) n FROM (SELECT visitor_key FROM analytics_visitors WHERE path=? UNION SELECT visitor_key FROM analytics_archive_visitors WHERE path=?)').get(path,path) as {n:number}).n;
  const sessions=(db.prepare('SELECT COUNT(*) n FROM (SELECT visitor_key,session_key FROM analytics_session_paths WHERE path=? UNION SELECT visitor_key,session_key FROM analytics_archive_sessions WHERE path=?)').get(path,path) as {n:number}).n;
  return {...totals,visitors,sessions};
}
export function archivedAnalyticsDays(db:Database.Database,start:string,end:string,page=1){
  if(!validDay(start)||!validDay(end)||start>end||!Number.isSafeInteger(page)||page<1)throw new WeavaError('汇总日期或页码无效。');
  const count=(db.prepare('SELECT COUNT(*) n FROM (SELECT d.day,d.path FROM analytics_archive_days d JOIN analytics_archives a ON a.id=d.archive_id WHERE a.restored_at IS NULL AND d.day>=? AND d.day<=? GROUP BY d.day,d.path)').get(start,end) as {n:number}).n;
  const items=db.prepare(`SELECT d.day,d.path,SUM(d.views) views,SUM(d.clicks) clicks,
    (SELECT COUNT(DISTINCT visitor_key) FROM analytics_archive_visitors v WHERE v.day=d.day AND v.path=d.path) visitors,
    (SELECT COUNT(*) FROM (SELECT DISTINCT visitor_key,session_key FROM analytics_archive_sessions v WHERE v.day=d.day AND v.path=d.path)) sessions
    FROM analytics_archive_days d JOIN analytics_archives a ON a.id=d.archive_id WHERE a.restored_at IS NULL AND d.day>=? AND d.day<=? GROUP BY d.day,d.path ORDER BY d.day DESC,d.path LIMIT 50 OFFSET ?`).all(start,end,(page-1)*50) as {day:string;path:string;views:number;clicks:number;visitors:number;sessions:number}[];
  return {start,end,page,pages:Math.ceil(count/50),total:count,items};
}
export function restoreAnalyticsArchive(db:Database.Database,root:string,id:string){
  const row=db.prepare('SELECT * FROM analytics_archives WHERE id=?').get(id) as {id:string;path:string;hash:string;restored_at:string|null}|undefined;
  if(!row)throw new WeavaError('统计归档不存在。',404);if(row.restored_at)return {id,restored:true};
  if(!/^[a-f0-9-]{36}$/.test(id))throw new WeavaError('归档编号无效。');
  const path=join(root,'archives','analytics',id+'.sqlite');if(!existsSync(path)||digestFile(path)!==row.hash)throw new WeavaError('统计归档文件缺失或校验失败。');
  db.prepare('ATTACH DATABASE ? AS archived_stats').run(path);
  try{return db.transaction(()=>{
    const collisions=(db.prepare('SELECT COUNT(*) n FROM events e JOIN archived_stats.events a ON a.id=e.id').get() as {n:number}).n;if(collisions)throw new WeavaError('归档与当前明细存在重复编号，未覆盖当前数据。',409);
    db.exec('INSERT INTO events SELECT * FROM archived_stats.events;INSERT INTO event_context SELECT * FROM archived_stats.event_context;INSERT INTO page_activity SELECT * FROM archived_stats.page_activity;');
    db.prepare('DELETE FROM analytics_archive_visitors WHERE archive_id=?').run(id);db.prepare('DELETE FROM analytics_archive_sessions WHERE archive_id=?').run(id);
    db.prepare("UPDATE analytics_archives SET restored_at=?,review=review||':restored:'||id WHERE id=?").run(new Date().toISOString(),id);return {id,restored:true};
  }).immediate();}finally{db.exec('DETACH DATABASE archived_stats');}
}
