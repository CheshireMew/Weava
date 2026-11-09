import type Database from 'better-sqlite3';
import { WeavaError } from '../../contracts/src/errors.ts';
import { normalizePath } from './paths.ts';
import {dayStart,dayInZone,shiftDay,validDay} from './analytics-dates.ts';
import {realtimeReport} from './analytics-realtime.ts';
import { referral } from './analytics-dimensions.ts';
import { BoundedCache } from './cache.ts';
import type { AnalyticsReport } from '../../contracts/src/analytics.ts';

const initialized=new WeakSet<Database.Database>();
const referrals=new BoundedCache<string,ReturnType<typeof referral>>(512);
function referralFallback(value:any){const key=String(value||'');let found=referrals.get(key);if(!found){found=referral(key);referrals.set(key,found);}return found;}
const overviews=new WeakMap<Database.Database,BoundedCache<string,any>>();
const ranges=new WeakMap<Database.Database,{key:string;cursor:number}>();
type Report=Omit<AnalyticsReport,'geo'|'lifetimeViews'|'historicalViews'|'lifetimePages'>;
const reports=new WeakMap<Database.Database,BoundedCache<string,Report>>();
interface PreparedRange {key:string;sessions:boolean;visitors:boolean;totals?:{views:number;visitors:number;sessions:number;clicks:number};previous?:any;activeMs?:number;daily?:any[]}
const filtered=new WeakMap<Database.Database,PreparedRange>();
const dimensions=['country','browser','os','device','model'] as const;
const byViews=(a:any,b:any)=>b.views-a.views||String(a.path||a.name||a.host||'').localeCompare(String(b.path||b.name||b.host||''));
const metric=`COALESCE(SUM(kind='view'),0) views,COUNT(DISTINCT CASE WHEN kind='view' THEN visitor_key END) visitors,COUNT(DISTINCT CASE WHEN kind='view' THEN session_token END) sessions,COALESCE(SUM(kind='click'),0) clicks`;
function context(c:string,e:string){return `COALESCE(${c}.country,'') country,COALESCE(NULLIF(${c}.browser,''),'未知') browser,COALESCE(NULLIF(${c}.os,''),'未知') os,COALESCE(NULLIF(${c}.device,''),'unknown') device,COALESCE(NULLIF(${c}.model,''),'未知') model,
  COALESCE(NULLIF(${c}.channel,''),weava_channel(${e}.referrer)) channel,COALESCE(NULLIF(${c}.engine,''),weava_engine(${e}.referrer)) engine,COALESCE(${c}.source,'') source,COALESCE(${c}.medium,'') medium,COALESCE(${c}.campaign,'') campaign`;}
function filters(params:URLSearchParams,alias:string,prefix='',channel=alias+'.channel'){
  const sql:string[]=[],args:any[]=[];
  if(params.get('path')){sql.push(`${alias}.${prefix}path=?`);args.push(normalizePath(params.get('path')!));}
  for(const key of dimensions)if(params.get(key)){sql.push(`COALESCE(NULLIF(${alias}.${prefix}${key},''),'未知')=?`);args.push(params.get(key));}
  if(params.get('channel')){sql.push(channel+'=?');args.push(params.get('channel'));}
  return {sql:sql.length?' AND '+sql.join(' AND '):'',args};
}
function baseMetrics(db:Database.Database,params:URLSearchParams,timezone:string,today:string){
  const path=params.get('path')?normalizePath(params.get('path')!):'';
  const generation=(db.prepare('SELECT events FROM analytics_generations WHERE id=1').get() as {events:number}).events;
  let cache=overviews.get(db);if(!cache){cache=new BoundedCache(32);overviews.set(db,cache);}
  const key=JSON.stringify([generation,path,timezone,today]);const cached=cache.get(key);if(cached)return cached;
  const metrics=(a:string,b:string)=>db.prepare(`SELECT COALESCE(SUM(kind='view'),0) views,COALESCE(SUM(kind='click'),0) clicks,
    COUNT(DISTINCT CASE WHEN kind='view' THEN COALESCE(NULLIF(visitor,''),id) END) visitors,
    COUNT(DISTINCT CASE WHEN kind='view' THEN json_array(COALESCE(NULLIF(visitor,''),id),COALESCE(NULLIF(session,''),id)) END) sessions FROM events WHERE ts>=? AND ts<?${path?' AND path=?':''}`)
    .get(dayStart(a,timezone),dayStart(shiftDay(b,1),timezone),...(path?[path]:[])) as any;
  const overview=[{name:'今天',start:today,end:today},{name:'昨天',start:shiftDay(today,-1),end:shiftDay(today,-1)},{name:'近 7 天',start:shiftDay(today,-6),end:today},{name:'近 30 天',start:shiftDay(today,-29),end:today}].map(period=>{
    const days=Math.round((Date.parse(period.end)-Date.parse(period.start))/86400000)+1;
    return {...period,...metrics(period.start,period.end),previous:metrics(shiftDay(period.start,-days),shiftDay(period.start,-1))};
  });
  const sum=(table:string,column:string)=>Number((db.prepare(`SELECT COALESCE(SUM(${column}),0) n FROM ${table}${path?' WHERE path=?':''}`).get(...(path?[path]:[])) as any).n);
  const lifetime={views:sum('view_counts','views'),clicks:sum('analytics_click_counts','clicks'),
    visitors:(db.prepare('SELECT COUNT(*) n FROM analytics_visitors WHERE path=?').get(path) as any).n,
    sessions:(db.prepare('SELECT COUNT(*) n FROM analytics_session_paths WHERE path=?').get(path) as any).n};
  return cache.set(key,{overview,lifetime});
}

/** SQLite holds and aggregates range data; Node receives aggregates and at most 100 visitor rows. */
export function queryAnalyticsReport(db:Database.Database,params:URLSearchParams,timezone:string,clock=Date.now()):Omit<AnalyticsReport,'geo'|'lifetimeViews'|'historicalViews'|'lifetimePages'>{
  const today=dayInZone(new Date(clock),timezone),start=params.get('start')||shiftDay(today,-29),end=params.get('end')||today;
  if(!validDay(start)||!validDay(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>3660)throw new WeavaError('日期范围无效，请选择不超过十年的有效日期。');
  const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1,previousStart=shiftDay(start,-days),previousEnd=shiftDay(start,-1);
  const current=dayStart(start,timezone),upper=dayStart(shiftDay(end,1),timezone);
  const section=params.get('section')||'all';
  if(!['all','overview','sources','visitors','devices','actions','filters'].includes(section))throw new WeavaError('统计分区无效。');
  const wants=(...sections:string[])=>section==='all'||sections.includes(section);
  const needSessions=wants('overview','sources'),needVisitors=wants('visitors'),needDimensions=wants('sources','devices','filters');
  const selection=[params.get('path')||'',params.get('channel')||'',...dimensions.map(key=>params.get(key)||'')];
  const generation=db.prepare('SELECT events,activity FROM analytics_generations WHERE id=1').get();
  const resultKey=JSON.stringify([start,end,timezone,today,selection,section,generation]);
  let resultCache=reports.get(db);if(!resultCache){resultCache=new BoundedCache(12,8*1024*1024);reports.set(db,resultCache);}
  const fresh=()=>({realtime:realtimeReport(db,new URLSearchParams(params.get('path')?{path:normalizePath(params.get('path')!)}:{}),clock),
    crawlers:wants('actions')?(db.prepare('SELECT agent,path,status,COUNT(*) requests FROM crawler_requests WHERE ts>=? AND ts<?'+(params.get('path')?' AND path=?':'')+' GROUP BY agent,path,status ORDER BY requests DESC').all(current,upper,...(params.get('path')?[normalizePath(params.get('path')!)]:[])) as any[]).map(row=>({...row,identity:'declared-user-agent'})):[],
    legacySources:db.prepare('SELECT id,path FROM legacy_sources').all() as {id:string;path:string}[]});
  const cached=resultCache.get(resultKey);if(cached)return {...structuredClone(cached),...fresh()};
  const rangeKey=JSON.stringify([previousStart,end,timezone]),oldRange=ranges.get(db);
  const feed=db.prepare('SELECT MIN(seq) first,MAX(seq) last FROM analytics_changes').get() as {first:number|null;last:number|null};
  const rebuild=!oldRange||oldRange.key!==rangeKey||oldRange.cursor<(feed.first??1)-1||oldRange.cursor>(feed.last??0)||!db.prepare("SELECT 1 FROM temp.sqlite_master WHERE name='weava_report_range'").get();
  if(rebuild){
    // SQLite keeps a bounded page cache and spills larger ranges automatically.
    // Do not scan every event a second time merely to estimate the scan's memory.
    db.pragma('temp_store=FILE');
    db.pragma('temp.cache_size=-32768');
  }
  if(!initialized.has(db)){
    db.function('weava_channel',{deterministic:true},(value:any)=>referralFallback(value).channel);
    db.function('weava_engine',{deterministic:true},(value:any)=>referralFallback(value).engine);
    initialized.add(db);
  }
  let cursor=0,prepared:PreparedRange;
  const result=db.transaction(()=>{
    const changes=db.prepare('SELECT MIN(seq) first,MAX(seq) last FROM analytics_changes').get() as {first:number|null;last:number|null};cursor=changes.last??0;
    const refresh=rebuild||oldRange!.cursor<(changes.first??1)-1||oldRange!.cursor>cursor;
    const rangeSelect=(changed=false)=>`SELECT e.id,e.kind,e.ts,e.path,e.visitor_key,e.session_key,e.session_token,e.active_ms,
      d.aligned,d.period,e.ts||e.id event_order
      FROM weava_report_days d JOIN analytics_facts e ${changed?'':'INDEXED BY analytics_fact_date'} ON e.ts>=d.lower AND e.ts<d.upper${changed?' WHERE e.id IN (SELECT id FROM analytics_changes WHERE seq>?)':''}`;
    const originsSelect=(changed=false)=>`WITH keys AS(SELECT DISTINCT visitor_key,session_key FROM weava_report_range WHERE kind='view'${changed?' AND (visitor_key,session_key) IN (SELECT visitor_key,session_key FROM analytics_changes WHERE seq>?)':''})
      SELECT b.visitor_key,b.session_key,f.ts first_ts,l.ts last_ts,f.path first_path,l.path last_path,
        f.country first_country,f.browser first_browser,f.os first_os,f.device first_device,f.model first_model,
        l.country last_country,l.browser last_browser,l.os last_os,l.device last_device,l.model last_model,
        COALESCE(NULLIF(f.channel,''),weava_channel(f.referrer)) channel,COALESCE(NULLIF(f.engine,''),weava_engine(f.referrer)) engine,
        f.referrer,f.source,f.medium,f.campaign
      FROM keys k JOIN analytics_session_bounds b ON b.visitor_key=k.visitor_key AND b.session_key=k.session_key
      JOIN analytics_facts f ON f.id=b.first_id JOIN analytics_facts l ON l.id=b.last_id`;
    if(refresh){
      db.exec('DROP TABLE IF EXISTS temp.weava_report_days;DROP TABLE IF EXISTS temp.weava_report_range;DROP TABLE IF EXISTS temp.weava_report_origins;CREATE TEMP TABLE weava_report_days(day TEXT,aligned TEXT,period INTEGER,lower TEXT,upper TEXT);');
      const insertDay=db.prepare('INSERT INTO weava_report_days VALUES(?,?,?,?,?)');let lower=dayStart(previousStart,timezone);
      for(let offset=0;offset<days*2;offset++){
        const day=shiftDay(previousStart,offset),upper=dayStart(shiftDay(day,1),timezone),period=Number(offset>=days);
        insertDay.run(day,period?day:shiftDay(day,days),period,lower,upper);lower=upper;
      }
      db.exec(`CREATE TEMP TABLE weava_report_range AS ${rangeSelect()};CREATE UNIQUE INDEX temp.weava_report_range_id ON weava_report_range(id);CREATE INDEX temp.weava_report_range_session ON weava_report_range(visitor_key,session_key,kind);
        CREATE TEMP TABLE weava_report_origins AS ${originsSelect()};CREATE UNIQUE INDEX temp.weava_report_origin_key ON weava_report_origins(visitor_key,session_key);`);
    }else if(cursor>oldRange!.cursor){
      const last=oldRange!.cursor;
      db.prepare('DELETE FROM weava_report_range WHERE id IN (SELECT id FROM analytics_changes WHERE seq>?)').run(last);
      db.prepare('INSERT INTO weava_report_range '+rangeSelect(true)).run(last);
      db.prepare('DELETE FROM weava_report_origins WHERE (visitor_key,session_key) IN (SELECT visitor_key,session_key FROM analytics_changes WHERE seq>?)').run(last);
      db.prepare('INSERT INTO weava_report_origins '+originsSelect(true)).run(last);
    }
    const filteredKey=JSON.stringify([rangeKey,cursor,selection]),old=filtered.get(db);
    const reuse=!refresh&&old?.key===filteredKey&&!!db.prepare("SELECT 1 FROM temp.sqlite_master WHERE name='weava_report_events'").get();
    prepared=reuse?{...old!}:{key:filteredKey,sessions:false,visitors:false};
    const needsFacts=!!params.get('channel')||dimensions.some(key=>!!params.get(key));
    const filter=filters(params,needsFacts?'f':'r','','COALESCE(o.channel,COALESCE(NULLIF(f.channel,\'\'),weava_channel(f.referrer)))');
    if(!reuse){
    db.exec('DROP TABLE IF EXISTS temp.weava_report_events;DROP TABLE IF EXISTS temp.weava_report_sessions;DROP TABLE IF EXISTS temp.weava_report_visitors;');
    db.prepare(`CREATE TEMP TABLE weava_report_events AS SELECT r.*
      FROM weava_report_range r ${needsFacts?'JOIN analytics_facts f ON f.id=r.id':''} ${params.get('channel')?'LEFT JOIN weava_report_origins o ON o.visitor_key=r.visitor_key AND o.session_key=r.session_key':''} WHERE 1=1${filter.sql}`).run(...filter.args);
    db.exec(`CREATE INDEX temp.weava_report_events_kind ON weava_report_events(period,kind);
      CREATE INDEX temp.weava_report_events_visitor ON weava_report_events(visitor_key,event_order);`);
    }
    if(needSessions&&!prepared.sessions){db.exec(`CREATE TEMP TABLE weava_report_sessions AS SELECT visitor_key,session_key,period,COUNT(*) views,MIN(aligned) first_day,MIN(event_order) first_order FROM weava_report_events WHERE kind='view' GROUP BY visitor_key,session_key,period;`);prepared.sessions=true;}
    if((needVisitors||needDimensions)&&!prepared.visitors){
    db.exec(`CREATE TEMP TABLE weava_report_visitors AS WITH aggregates AS(
        SELECT visitor_key id,COUNT(*) views,COUNT(DISTINCT session_token) sessions,MIN(ts) firstSeen,MAX(ts) lastSeen,SUM(active_ms) activeMs,MIN(event_order) first_order,MAX(event_order) last_order
        FROM weava_report_events WHERE period=1 AND kind='view' GROUP BY visitor_key)
      SELECT v.*,COALESCE(o.first_path,e.path) entryPath,COALESCE(o.last_path,e.path) exitPath,f.country,f.browser,f.os,f.device,f.model,COALESCE(o.channel,COALESCE(NULLIF(f.channel,''),weava_channel(f.referrer))) channel,
        COALESCE(NULLIF(COALESCE(o.source,f.source),''),NULLIF(COALESCE(o.engine,NULLIF(f.engine,''),weava_engine(f.referrer)),''),NULLIF(COALESCE(o.referrer,f.referrer),''),'直接 / 未知') source
      FROM aggregates v JOIN weava_report_events e ON e.visitor_key=v.id AND e.event_order=v.last_order
      JOIN analytics_facts f ON f.id=e.id
      LEFT JOIN weava_report_origins o ON o.visitor_key=e.visitor_key AND o.session_key=e.session_key;`);
    prepared.visitors=true;
    }
    const all=(sql:string,...args:any[])=>db.prepare(sql).all(...args) as any[];
    if(!prepared.totals){
      const {activeMs,...totals}=db.prepare(`SELECT ${metric},COALESCE(SUM(CASE WHEN kind='view' THEN active_ms ELSE 0 END),0) activeMs FROM weava_report_events WHERE period=1`).get() as {views:number;visitors:number;sessions:number;clicks:number;activeMs:number};
      prepared.totals=totals;prepared.activeMs=activeMs;prepared.previous=db.prepare(`SELECT ${metric} FROM weava_report_events WHERE period=0`).get();
    }
    const totals=prepared.totals,previous=prepared.previous;
    const daily=wants('overview','sources')?(prepared.daily??=all(`SELECT aligned date,COALESCE(SUM(kind='view' AND period=1),0) views,COUNT(DISTINCT CASE WHEN kind='view' AND period=1 THEN visitor_key END) visitors,
      COUNT(DISTINCT CASE WHEN kind='view' AND period=1 THEN session_token END) sessions,COALESCE(SUM(kind='click' AND period=1),0) clicks,
      COALESCE(SUM(kind='view' AND period=0),0) previousViews,COUNT(DISTINCT CASE WHEN kind='view' AND period=0 THEN visitor_key END) previousVisitors
      FROM weava_report_events GROUP BY aligned`)):[];
    const dates=new Map(daily.map(row=>[row.date,row]));
    const pages=wants('overview')?all(`SELECT path,COALESCE(SUM(kind='view'),0) views,COUNT(DISTINCT CASE WHEN kind='view' THEN visitor_key END) visitors,COALESCE(SUM(kind='click'),0) clicks,
      0 entries,0 exits,COALESCE(SUM(CASE WHEN kind='view' THEN active_ms ELSE 0 END),0) activeMs FROM weava_report_events WHERE period=1 GROUP BY path`):[];
    const pageMap=new Map(pages.map(row=>[row.path,row]));
    if(wants('overview'))for(const [column,prefix,ts] of [['entries','first_','first_ts'],['exits','last_','last_ts']] as const){
      const selected=filters(params,'o',prefix,'o.channel');
      for(const row of all(`SELECT o.${prefix}path path,COUNT(*) count FROM weava_report_sessions s JOIN weava_report_origins o USING(visitor_key,session_key) WHERE s.period=1 AND o.${ts}>=? AND o.${ts}<?${selected.sql} GROUP BY o.${prefix}path`,current,upper,...selected.args))if(pageMap.has(row.path))pageMap.get(row.path)![column]=row.count;
    }
    for(const page of pages)page.averageActiveMs=page.views?Math.round(page.activeMs/page.views):0;
    const engines=new Map<string,any>();
    if(wants('overview','sources'))for(const row of all(`SELECT o.engine name,o.channel,s.period,s.first_day date,COUNT(*) sessions,SUM(s.views) views,MIN(s.first_order) first_order FROM weava_report_sessions s JOIN weava_report_origins o USING(visitor_key,session_key) WHERE o.engine<>'' GROUP BY o.engine,s.period,s.first_day ORDER BY s.period DESC,first_order`)){
      const engine=engines.get(row.name)??{name:row.name,channel:row.channel,sessions:0,views:0,daily:[],previousViews:0,previousSessions:0,previousDaily:[]};
      if(row.period){engine.sessions+=row.sessions;engine.views+=row.views;engine.daily.push({date:row.date,sessions:row.sessions,views:row.views});}
      else{engine.previousSessions+=row.sessions;engine.previousViews+=row.views;engine.previousDaily.push({date:row.date,sessions:row.sessions,views:row.views});}engines.set(row.name,engine);
    }
    const dimension=(key:string)=>!(key==='country'?wants('sources','filters'):wants('devices','filters'))?[]:all(`SELECT COALESCE(NULLIF(${key},''),'未知') name,COUNT(*) visitors FROM weava_report_visitors GROUP BY name`).map(row=>({...row,share:totals.visitors?row.visitors/totals.visitors:0})).sort((a,b)=>b.visitors-a.visitors||a.name.localeCompare(b.name));
    const visitorRows=(order:string)=>!needVisitors?[]:all('SELECT * FROM weava_report_visitors ORDER BY '+order+' LIMIT 100').map(({first_order,last_order,...row})=>row);
    const path=params.get('path')?normalizePath(params.get('path')!):'';
    return {...totals,...(section==="all"?{}:{section:section as NonNullable<AnalyticsReport["section"]>}),range:{start,end,previousStart,previousEnd,days,timezone},previous,...baseMetrics(db,params,timezone,today),
      averageActiveMs:totals.views?Math.round(prepared.activeMs!/totals.views):0,
      pages:pages.sort(byViews),daily:Array.from({length:days},(_,offset)=>{const date=shiftDay(start,offset);return dates.get(date)??{date,views:0,visitors:0,sessions:0,clicks:0,previousViews:0,previousVisitors:0};}),
      links:wants('actions')?all("SELECT e.path,f.url,f.zone,f.label,COUNT(*) clicks FROM weava_report_events e JOIN analytics_facts f ON f.id=e.id WHERE e.period=1 AND e.kind='click' GROUP BY e.path,f.url,f.zone,f.label ORDER BY clicks DESC,MIN(e.event_order)"):[],
      sources:wants('sources')?all(`SELECT o.channel,NULLIF(o.referrer,'') host,COALESCE(NULLIF(o.source,''),NULLIF(o.engine,''),NULLIF(o.referrer,''),'直接 / 未知') name,SUM(s.views) views,COUNT(*) sessions,COUNT(DISTINCT s.visitor_key) visitors
        FROM weava_report_sessions s JOIN weava_report_origins o USING(visitor_key,session_key) WHERE s.period=1 GROUP BY o.channel,o.referrer,o.source,o.medium,o.campaign ORDER BY MIN(s.first_order)`).sort(byViews):[],
      engines:[...engines.values()],campaigns:wants('sources')?all(`SELECT o.source,o.medium,o.campaign,COUNT(*) sessions,SUM(s.views) views FROM weava_report_sessions s JOIN weava_report_origins o USING(visitor_key,session_key) WHERE s.period=1 AND (o.source<>'' OR o.campaign<>'') GROUP BY o.source,o.medium,o.campaign ORDER BY views DESC,MIN(s.first_order)`):[],
      countries:dimension('country'),browsers:dimension('browser'),operatingSystems:dimension('os'),devices:dimension('device'),models:dimension('model'),
      recentVisitors:visitorRows('lastSeen DESC,first_order'),activeVisitors:visitorRows('views DESC,first_order'),
      actions:wants('actions')?all("SELECT f.label name,COUNT(*) count FROM weava_report_events e JOIN analytics_facts f ON f.id=e.id WHERE e.period=1 AND e.kind='event' GROUP BY f.label ORDER BY MIN(e.event_order)"):[],
      ...fresh()};
  })();
  ranges.set(db,{key:rangeKey,cursor});
  filtered.set(db,prepared!);
  resultCache.set(resultKey,structuredClone(result),JSON.stringify(result).length*2);
  return result;
}
