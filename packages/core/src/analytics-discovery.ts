import type Database from 'better-sqlite3';
import {WeavaError} from '@weava/contracts';
import {dayStart,shiftDay,dayInZone,validDay} from './analytics-dates.ts';
import {analyticsArchiveSchema} from './analytics-archive.ts';
export function migrateAnalyticsDiscovery(db:Database.Database){
  analyticsArchiveSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_health(id INTEGER PRIMARY KEY CHECK(id=1),last_accepted TEXT);INSERT OR IGNORE INTO analytics_health VALUES(1,NULL);
    CREATE TABLE IF NOT EXISTS search_events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,query TEXT NOT NULL,total INTEGER NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS search_event_date ON search_events(ts,query);
    CREATE TABLE IF NOT EXISTS search_clicks(id TEXT PRIMARY KEY,search_id TEXT NOT NULL,target TEXT NOT NULL,ts TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS search_click_event ON search_clicks(search_id);
    CREATE TABLE IF NOT EXISTS missing_requests(day TEXT NOT NULL,path TEXT NOT NULL,referrer TEXT NOT NULL,count INTEGER NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(day,path,referrer));`);
}
export function collectSearch(db:Database.Database,item:any,visitor:string,session:string,at:string,allowed:Set<string>){
  if(item.kind==='search'){
    const query=String(item.query??'').normalize('NFKC').trim().slice(0,200);
    if(item.path!=='/search/'||!query||!Number.isSafeInteger(item.total)||item.total<0||item.total>10000000)return 0;
    return db.prepare('INSERT OR IGNORE INTO search_events VALUES(?,?,?,?,?,?)').run(item.id,at,query,item.total,visitor,session).changes;
  }
  const search=db.prepare('SELECT visitor FROM search_events WHERE id=?').get(item.searchId) as {visitor:string}|undefined;
  let target='';try{const url=new URL(String(item.target),'https://weava.invalid');target=url.pathname;}catch{return 0;}
  if(!search||search.visitor!==visitor||!allowed.has(target))return 0;
  return db.prepare('INSERT OR IGNORE INTO search_clicks VALUES(?,?,?,?)').run(item.id,item.searchId,target,at).changes;
}
export function discoveryReport(db:Database.Database,params:URLSearchParams,timezone:string){
  const today=dayInZone(new Date(),timezone),start=params.get('start')||shiftDay(today,-29),end=params.get('end')||today,page=Number(params.get('page')??1),dataset=params.get('dataset')??'search';
  if(!validDay(start)||!validDay(end)||start>end||!Number.isSafeInteger(page)||page<1||!['search','missing'].includes(dataset))throw new WeavaError('报告日期、页码或类型无效。');
  const lower=dayStart(start,timezone),upper=dayStart(shiftDay(end,1),timezone),pageSize=50;
  if(dataset==='search'){
    const total=(db.prepare('SELECT COUNT(DISTINCT query) n FROM search_events WHERE ts>=? AND ts<?').get(lower,upper) as {n:number}).n;
    const items=db.prepare(`SELECT query,COUNT(*) searches,SUM(total=0) emptyResults,SUM(EXISTS(SELECT 1 FROM search_clicks c WHERE c.search_id=s.id)) clickedSearches,
      (SELECT COUNT(*) FROM search_clicks c JOIN search_events t ON t.id=c.search_id WHERE t.query=s.query AND t.ts>=? AND t.ts<?) clicks,MAX(ts) lastSeen
      FROM search_events s WHERE ts>=? AND ts<? GROUP BY query ORDER BY searches DESC,query LIMIT ? OFFSET ?`).all(lower,upper,lower,upper,pageSize,(page-1)*pageSize) as {query:string;searches:number;emptyResults:number;clickedSearches:number;clicks:number;lastSeen:string}[];
    return {dataset:'search' as const,start,end,page,pageSize,pages:Math.ceil(total/pageSize),total,items,missing:[] as {path:string;referrer:string;requests:number;lastSeen:string}[]};
  }
  const total=(db.prepare('SELECT COUNT(*) n FROM (SELECT path,referrer FROM missing_requests WHERE day>=? AND day<=? GROUP BY path,referrer)').get(start,end) as {n:number}).n;
  const missing=db.prepare('SELECT path,referrer,SUM(count) requests,MAX(last_seen) lastSeen FROM missing_requests WHERE day>=? AND day<=? GROUP BY path,referrer ORDER BY requests DESC,path,referrer LIMIT ? OFFSET ?').all(start,end,pageSize,(page-1)*pageSize) as {path:string;referrer:string;requests:number;lastSeen:string}[];
  return {dataset:'missing' as const,start,end,page,pageSize,pages:Math.ceil(total/pageSize),total,items:[] as {query:string;searches:number;emptyResults:number;clickedSearches:number;clicks:number;lastSeen:string}[],missing};
}
