import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { WeavaError } from '../../contracts/src/errors.ts';
import { normalizePath } from './paths.ts';
import { AnalyticsGeo } from './analytics-geo.ts';
import { deviceInfo, referral, type AnalyticsContext } from './analytics-dimensions.ts';
import { declaredCrawler, isAutomatedAgent } from './analytics-agents.ts';
import { analyticsReport, realtimeReport, visitorReport } from './analytics-reports.ts';
import { acquireInstanceWriter, type InstanceWriter } from './instance-access.ts';
import { analyticsIndex } from './analytics-index.ts';
import { analyticsFacts } from './analytics-facts.ts';
import { AnalyticsIngress } from './analytics-ingress.ts';
import { mergeWordpressAnalytics, wordpressLifetime } from './analytics-wordpress.ts';
import {migrateAnalyticsDiscovery,collectSearch,discoveryReport} from './analytics-discovery.ts';
import {dayInZone} from './analytics-dates.ts';
import {previewAnalyticsArchive,archiveAnalytics,listAnalyticsArchives,archivedAnalyticsDays,restoreAnalyticsArchive} from './analytics-archive.ts';
export interface HistoricalViewImport {
  sourceId: string;
  capturedAt: string;
  entries: { entryId: string; path: string; views: number }[];
}
export class Analytics {
  raw!: Database.Database;
  geo: AnalyticsGeo;
  private writer: InstanceWriter;
  private ingress!: AnalyticsIngress;
  constructor(private root: string, options: { mode?: 'open' | 'migrate' } = {}) {
    this.writer = acquireInstanceWriter(root);
    try {
    this.geo = new AnalyticsGeo(root);
    const fresh = !existsSync(join(root, 'analytics.sqlite'));
    this.raw = new Database(join(root, 'analytics.sqlite'));
    this.raw.pragma('journal_mode=WAL');
    this.raw.pragma('busy_timeout=5000');
    this.raw.pragma('cache_size=-32768');
    const initialized = this.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='weava_analytics_schema'").get();
    const schema = initialized ? (this.raw.prepare('SELECT version FROM weava_analytics_schema').get() as {version:number})?.version : 0;
    if (schema > 3) throw new WeavaError('统计数据库版本比当前程序新。');
    if(schema>0&&schema<3&&options.mode!=='migrate'&&process.env.WEAVA_DATABASE_MODE!=='migrate')throw new WeavaError('统计数据库需要显式迁移，请使用 site update 或 site adopt。',409);
    if (!schema && !fresh && options.mode !== 'migrate' && process.env.WEAVA_DATABASE_MODE !== 'migrate') throw new WeavaError('统计数据库需要显式迁移，请使用 site update 或 site adopt。',409);
    if (!schema) {
    this.raw.exec(
      `CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,visitor TEXT NOT NULL,session TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,release_id TEXT NOT NULL);CREATE INDEX IF NOT EXISTS event_date ON events(ts,path);CREATE TABLE IF NOT EXISTS legacy_sources(id TEXT PRIMARY KEY,path TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS historical_views(entry_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,path TEXT NOT NULL,views INTEGER NOT NULL CHECK(views>=0),captured_at TEXT NOT NULL);`,
    );
    this.raw
      .exec(`CREATE TABLE IF NOT EXISTS event_context(event_id TEXT PRIMARY KEY,country TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,device TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,channel TEXT NOT NULL,engine TEXT NOT NULL,source TEXT NOT NULL,medium TEXT NOT NULL,campaign TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS page_activity(view_id TEXT PRIMARY KEY,last_seen TEXT NOT NULL,active_ms INTEGER NOT NULL,scroll INTEGER NOT NULL,closed INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS activity_seen ON page_activity(last_seen,closed);
      CREATE INDEX IF NOT EXISTS event_session ON events(visitor,session,ts);
      CREATE INDEX IF NOT EXISTS event_kind_date ON events(kind,ts);`);
    this.raw.exec(
      'CREATE TABLE IF NOT EXISTS crawler_requests(id TEXT PRIMARY KEY,ts TEXT NOT NULL,path TEXT NOT NULL,agent TEXT NOT NULL,status INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS crawler_date ON crawler_requests(ts,path);',
    );
    this.raw.transaction(() => {
      if (!this.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='view_counts'").get()) {
        this.raw.exec(`CREATE TABLE view_counts(path TEXT PRIMARY KEY,views INTEGER NOT NULL);
          INSERT INTO view_counts SELECT path,COUNT(*) FROM events WHERE kind='view' GROUP BY path;`);
      }
      this.raw.exec(`CREATE TRIGGER IF NOT EXISTS count_view_insert AFTER INSERT ON events WHEN NEW.kind='view' BEGIN
          INSERT INTO view_counts VALUES(NEW.path,1) ON CONFLICT(path) DO UPDATE SET views=views+1; END;
        CREATE TRIGGER IF NOT EXISTS count_view_delete AFTER DELETE ON events WHEN OLD.kind='view' BEGIN
          UPDATE view_counts SET views=views-1 WHERE path=OLD.path; END;
        CREATE TRIGGER IF NOT EXISTS count_view_update AFTER UPDATE OF kind,path ON events BEGIN
          UPDATE view_counts SET views=views-1 WHERE OLD.kind='view' AND path=OLD.path;
          INSERT INTO view_counts SELECT NEW.path,1 WHERE NEW.kind='view' ON CONFLICT(path) DO UPDATE SET views=views+1; END;`);
    }).immediate();
    analyticsIndex(this.raw);
    analyticsFacts(this.raw);
    this.raw.exec('CREATE TABLE IF NOT EXISTS weava_analytics_schema(version INTEGER NOT NULL); INSERT INTO weava_analytics_schema VALUES(1);');
    }
    if(schema<3)this.raw.transaction(()=>{migrateAnalyticsDiscovery(this.raw);this.raw.prepare('UPDATE weava_analytics_schema SET version=3').run();}).immediate();
    this.ingress = new AnalyticsIngress(this.raw,root);
    } catch (error) { if (this.raw?.open) this.raw.close(); this.writer.release(); throw error; }
  }
  collect(value: any, agent: string, allowed: Set<string>, context: AnalyticsContext = {}) {
    if (isAutomatedAgent(agent)) return { accepted: 0 };
    const batch = Array.isArray(value) ? value : [value];
    if (batch.length > 100) throw new WeavaError('事件数量过多。');
    this.ingress.reserve(context.ip??'unknown',batch.length);
    let count = 0;
    const insert = this.raw.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const detail = this.raw.prepare(
      'INSERT OR IGNORE INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    const activity = this.raw.prepare('INSERT OR IGNORE INTO page_activity VALUES(?,?,0,0,0)');
    const findView = this.raw.prepare(
      "SELECT e.ts FROM events e WHERE e.id=? AND e.kind='view' AND e.visitor=? AND e.session=? AND e.path=?",
    );
    const pulse = this.raw.prepare(
      'UPDATE page_activity SET last_seen=MAX(last_seen,?),active_ms=MAX(active_ms,?),scroll=MAX(scroll,?),closed=CASE WHEN last_seen<=? THEN ? ELSE closed END WHERE view_id=?',
    );
    const country = this.geo.country(context.ip);
    this.raw.transaction(() => {
      for (const item of batch) {
        if (
          !item ||
          !['view', 'click', 'event', 'pulse','search','search-click'].includes(item.kind) ||
          typeof item.path !== 'string'
        )
          continue;
        if (item.kind === 'event' && !/^[\w.:-]{1,80}$/.test(item.label ?? '')) continue;
        let path: string;
        try {
          path = normalizePath(item.path);
        } catch {
          continue;
        }
        if (!allowed.has(path)&&!(path==='/search/'&&['view','click','event','search','search-click','pulse'].includes(item.kind))) continue;
        const ts = Date.parse(item.ts);
        if (!Number.isFinite(ts) || ts > Date.now() + 300000 || ts < Date.now() - 7 * 86400000)
          continue;
        if (!/^[\w-]{10,100}$/.test(item.id ?? '')) continue;
        const visitor = String(item.visitor || 'anonymous-' + item.id).slice(0, 100),
          session = String(item.session || item.id).slice(0, 100),
          at = new Date(ts).toISOString();
        if(item.kind==='search'||item.kind==='search-click'){count+=collectSearch(this.raw,item,visitor,session,at,allowed);continue;}
        if (item.kind === 'pulse') {
          const view = findView.get(String(item.viewId || ''), visitor, session, path) as
            | { ts: string }
            | undefined;
          if (!view || ts < Date.parse(view.ts)) continue;
          const activeMs = Math.min(
            Math.max(0, Math.round(Number(item.activeMs) || 0)),
            Math.max(0, ts - Date.parse(view.ts)),
          );
          const scroll = Math.min(100, Math.max(0, Math.round(Number(item.scroll) || 0)));
          count += pulse.run(at, activeMs, scroll, at, item.closed ? 1 : 0, item.viewId).changes;
          continue;
        }
        const origin = referral(String(item.referrer || ''), context.origin, item.campaign);
        const added = insert.run(
          item.id,
          item.kind,
          at,
          path,
          visitor,
          session,
          String(item.url ?? '').slice(0, 4000),
          String(item.label ?? '').slice(0, 200),
          String(item.zone ?? 'body').slice(0, 100),
          origin.host,
          String(item.releaseId ?? '').slice(0, 100),
        ).changes;
        if (!added) continue;
        count++;
        const device = deviceInfo(agent, item.hints);
        detail.run(
          item.id,
          country,
          device.browser,
          device.os,
          device.device,
          device.model,
          String(context.language || item.language || '')
            .split(',')[0]
            .slice(0, 35),
          origin.channel,
          origin.engine,
          origin.source,
          origin.medium,
          origin.campaign,
          1,
        );
        if (item.kind === 'view') activity.run(item.id, at);
      }
    })();
    if(count)this.raw.prepare('UPDATE analytics_health SET last_accepted=? WHERE id=1').run(new Date().toISOString());
    return { accepted: count };
  }
  collectionStatus(){const archives=listAnalyticsArchives(this.raw).filter(row=>!row.restoredAt);return {...this.ingress.status(),lastAcceptedAt:(this.raw.prepare('SELECT last_accepted value FROM analytics_health WHERE id=1').get() as {value:string|null}).value,archives:archives.length,archivedBefore:archives.map(row=>row.before).sort().at(-1)??null};}
  previewArchive(before:string){return this.raw.transaction(()=>previewAnalyticsArchive(this.raw,before)).deferred();}
  archive(before:string,review:string,budgetBytes?:number){return archiveAnalytics(this.raw,this.root,before,review,budgetBytes);}
  archives(){return listAnalyticsArchives(this.raw).map(row=>({...row,path:join(this.root,'archives','analytics',row.id+'.sqlite')}));}
  archiveDays(start:string,end:string,page=1){return archivedAnalyticsDays(this.raw,start,end,page);}
  restoreArchive(id:string){return restoreAnalyticsArchive(this.raw,this.root,id);}
  discovery(params:URLSearchParams,timezone='Asia/Shanghai'){return discoveryReport(this.raw,params,timezone);}
  recordMissing(path:string,referrer:string,agent:string,network:string,timezone='Asia/Shanghai'){
    if(isAutomatedAgent(agent)||path.length>2000)return;
    this.ingress.reserve(network,1);let source='';try{const url=new URL(referrer);source=url.origin+url.pathname;}catch{}
    const time=new Date(),day=dayInZone(time,timezone);
    this.raw.prepare('INSERT INTO missing_requests VALUES(?,?,?,1,?) ON CONFLICT(day,path,referrer) DO UPDATE SET count=count+1,last_seen=excluded.last_seen').run(day,normalizePath(path),source,time.toISOString());
  }
  recordCrawler(path: string, agent: string, status: number, network='unknown') {
    const known = declaredCrawler(agent);
    if (!known) return;
    // Dropping telemetry must never make the actual article unavailable.
    try { this.ingress.reserve(network,1); }
    catch(error) { if(error instanceof WeavaError && [429,503].includes(error.status))return;throw error; }
    this.raw
      .prepare('INSERT INTO crawler_requests VALUES(?,?,?,?,?)')
      .run(
        crypto.randomUUID(),
        new Date().toISOString(),
        normalizePath(path),
        known,
        status,
      );
  }
  importViewTotals(input: HistoricalViewImport) {
    if (
      !input.sourceId?.trim() ||
      !Number.isFinite(Date.parse(input.capturedAt)) ||
      !Array.isArray(input.entries)
    )
      throw new WeavaError('历史浏览量来源或时间无效。');
    const seen = new Set<string>();
    const entries = input.entries.map((item) => {
      if (
        !item.entryId?.trim() ||
        seen.has(item.entryId) ||
        !Number.isSafeInteger(item.views) ||
        item.views < 0
      )
        throw new WeavaError('历史浏览量编号重复或计数无效。');
      seen.add(item.entryId);
      return { ...item, path: normalizePath(item.path) };
    });
    const capturedAt = new Date(input.capturedAt).toISOString();
    return this.raw
      .transaction(() => {
        const find = this.raw.prepare(
          'SELECT source_id,captured_at FROM historical_views WHERE entry_id=?',
        );
        const upsert = this.raw
          .prepare(`INSERT INTO historical_views VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET path=excluded.path,views=excluded.views,captured_at=excluded.captured_at
        WHERE historical_views.path<>excluded.path OR historical_views.views<>excluded.views OR historical_views.captured_at<>excluded.captured_at`);
        let changed = 0;
        for (const item of entries) {
          const previous = find.get(item.entryId) as
            | { source_id: string; captured_at: string }
            | undefined;
          if (previous && previous.source_id !== input.sourceId)
            throw new WeavaError(
              '这篇文章已有其他来源的历史浏览量，不能重复叠加：' + item.entryId,
              409,
            );
          if (previous && previous.captured_at > capturedAt)
            throw new WeavaError('历史浏览量快照比已导入的数据旧。', 409);
          changed += upsert.run(
            item.entryId,
            input.sourceId,
            item.path,
            item.views,
            capturedAt,
          ).changes;
        }
        return {
          sourceId: input.sourceId,
          capturedAt,
          entries: entries.length,
          views: entries.reduce((sum, item) => sum + item.views, 0),
          changed,
        };
      })
      .immediate();
  }
  viewTotals(entries: { id: string; path: string }[]) {
    const historical = new Map<string,number>(), recorded = new Map<string,number>();
    const wordpress = wordpressLifetime(this.raw);
    for(let offset=0;offset<entries.length;offset+=200){
      const batch=entries.slice(offset,offset+200),marks=batch.map(()=>'?').join(',');
      for(const row of this.raw.prepare(`SELECT entry_id,views FROM historical_views WHERE entry_id IN (${marks})`).all(...batch.map(entry=>entry.id)) as {entry_id:string;views:number}[]) historical.set(row.entry_id,row.views);
      for(const row of this.raw.prepare(`SELECT path,views FROM view_counts WHERE path IN (${marks})`).all(...batch.map(entry=>normalizePath(entry.path))) as {path:string;views:number}[]) recorded.set(row.path,row.views);
      for(const row of this.raw.prepare(`SELECT d.path,SUM(d.views) views FROM analytics_archive_days d JOIN analytics_archives a ON a.id=d.archive_id WHERE a.restored_at IS NULL AND d.path IN (${marks}) GROUP BY d.path`).all(...batch.map(entry=>normalizePath(entry.path))) as {path:string;views:number}[])recorded.set(row.path,(recorded.get(row.path)??0)+row.views);
    }
    return new Map(
      entries.map((entry) => [
        entry.id,
        (wordpress ? wordpress.entries.get(entry.id) ?? wordpress.pages.get(normalizePath(entry.path)) ?? 0 : historical.get(entry.id) ?? 0) + (recorded.get(normalizePath(entry.path)) ?? 0),
      ]),
    );
  }
  lifetime(pathFilter?: string) {
    const path = pathFilter ? normalizePath(pathFilter) : '';
    const pages = new Map<
      string,
      { path: string; views: number; historicalViews: number; recordedViews: number }
    >();
    const page = (path: string) => {
      let row = pages.get(path);
      if (!row) {
        row = { path, views: 0, historicalViews: 0, recordedViews: 0 };
        pages.set(path, row);
      }
      return row;
    };
    for (const row of this.raw
      .prepare(
        'SELECT path,SUM(views) views FROM historical_views' +
          (path ? ' WHERE path=?' : '') +
          ' GROUP BY path',
      )
      .all(...(path ? [path] : [])) as any[])
      page(row.path).historicalViews = row.views;
    for (const row of this.raw
      .prepare(
        'SELECT path,views FROM view_counts WHERE views>0' + (path ? ' AND path=?' : ''),
      )
      .all(...(path ? [path] : [])) as any[])
      page(row.path).recordedViews = row.views;
    for (const row of pages.values()) row.views = row.historicalViews + row.recordedViews;
    for(const row of this.raw.prepare('SELECT d.path,SUM(d.views) views FROM analytics_archive_days d JOIN analytics_archives a ON a.id=d.archive_id WHERE a.restored_at IS NULL'+(path?' AND d.path=?':'')+' GROUP BY d.path').all(...(path?[path]:[])) as {path:string;views:number}[]){const item=page(row.path);item.recordedViews+=row.views;item.views=item.historicalViews+item.recordedViews;}
    const rows = [...pages.values()].sort(
      (a, b) => b.views - a.views || a.path.localeCompare(b.path),
    );
    return {
      lifetimeViews: rows.reduce((sum, row) => sum + row.views, 0),
      historicalViews: rows.reduce((sum, row) => sum + row.historicalViews, 0),
      lifetimePages: rows,
    };
  }
  report(params: URLSearchParams, timezone = 'Asia/Shanghai') {
    return mergeWordpressAnalytics(this.raw, {
      ...analyticsReport(this.raw, params, timezone),
      ...this.lifetime(params.get('path') || undefined),
      geo: this.geo.status(),
    }, params);
  }
  realtime(params = new URLSearchParams()) {
    return realtimeReport(this.raw, params);
  }
  visitor(id: string, params = new URLSearchParams(), timezone = 'Asia/Shanghai') {
    return visitorReport(this.raw, id, params, timezone);
  }
  export(params: URLSearchParams, timezone = 'Asia/Shanghai') {
    const report = this.report(params, timezone),
      dataset = params.get('dataset') || 'pages';
    const datasets: Record<string, any[]> = {
      pages: report.pages,
      daily: report.daily,
      sources: report.sources,
      countries: report.countries,
      browsers: report.browsers,
      os: report.operatingSystems,
      devices: report.devices,
      models: report.models,
      visitors: report.recentVisitors,
      links: report.links,
      actions: report.actions,
      campaigns: report.campaigns,
      crawlers: report.crawlers,
      lifetime: report.lifetimePages,
    };
    if (!Object.hasOwn(datasets, dataset)) throw new WeavaError('统计导出类型不存在。');
    const columns: Record<string, string[]> = {
      pages: [
        'path',
        'views',
        'visitors',
        'clicks',
        'entries',
        'exits',
        'activeMs',
        'averageActiveMs',
      ],
      daily: [
        'date',
        'views',
        'visitors',
        'sessions',
        'clicks',
        'previousViews',
        'previousVisitors',
      ],
      sources: ['channel', 'host', 'name', 'views', 'sessions', 'visitors'],
      countries: ['name', 'visitors', 'share'],
      browsers: ['name', 'visitors', 'share'],
      os: ['name', 'visitors', 'share'],
      devices: ['name', 'visitors', 'share'],
      models: ['name', 'visitors', 'share'],
      visitors: [
        'id',
        'views',
        'sessions',
        'firstSeen',
        'lastSeen',
        'entryPath',
        'exitPath',
        'country',
        'browser',
        'os',
        'device',
        'model',
        'channel',
        'source',
        'activeMs',
      ],
      links: ['path', 'url', 'zone', 'label', 'clicks'],
      actions: ['name', 'count'],
      campaigns: ['source', 'medium', 'campaign', 'sessions', 'views'],
      crawlers: ['agent', 'path', 'status', 'requests', 'identity'],
      lifetime: ['path', 'views', 'historicalViews', 'recordedViews'],
    };
    return csv(datasets[dataset], columns[dataset]);
  }
  close() {
    this.geo.close();
    if (this.raw.open) this.raw.close();
    this.writer.release();
  }
}
export function csv(rows: any[], columns?: string[]) {
  if (!rows.length && !columns) return '\ufeff';
  const keys = columns || Object.keys(rows[0]);
  const cell = (v: any) => {
    let text=String(v??'');
    // CSV quoting alone does not stop Excel from evaluating attacker-controlled formulas.
    // A tab inside the quoted field keeps dangerous text cells as text; numbers stay numeric.
    if(typeof v==='string' && /^[\s\p{Cf}\x00-\x1f]*[=+\-@＝＋－＠]/u.test(text)) text='\t'+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return (
    '\ufeff' +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))].map((r) => r.map(cell).join(',')).join('\r\n')
  );
}
