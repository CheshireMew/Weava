import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';

export interface AnalyticsIngressPolicy {
  sourceRequests: number;
  sourceEvents: number;
  globalRequests: number;
  globalEvents: number;
  dailyEvents: number;
  sourceDailyEvents: number;
  maximumBytes: number;
  minimumFreeBytes: number;
  maximumSources: number;
}
export const analyticsIngressDefaults: AnalyticsIngressPolicy = {
  sourceRequests:120, sourceEvents:600, globalRequests:1200, globalEvents:6000,
  dailyEvents:100000, sourceDailyEvents:20000,
  maximumBytes:1024*1024*1024, minimumFreeBytes:512*1024*1024, maximumSources:4096,
};
function configured(name: string, fallback: number, minimum: number) {
  const raw=process.env[name];
  if(raw===undefined) return fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<minimum) throw new WeavaError(name+' 需要是大于等于 '+minimum+' 的整数。');
  return value;
}
export function analyticsIngressPolicy(): AnalyticsIngressPolicy {
  return {...analyticsIngressDefaults,
    dailyEvents:configured('WEAVA_ANALYTICS_DAILY_EVENTS',analyticsIngressDefaults.dailyEvents,1),
    maximumBytes:configured('WEAVA_ANALYTICS_MAX_BYTES',analyticsIngressDefaults.maximumBytes,64*1024*1024),
    minimumFreeBytes:configured('WEAVA_ANALYTICS_MIN_FREE_BYTES',analyticsIngressDefaults.minimumFreeBytes,64*1024*1024),
  };
}
/** Shared, persistent budgets also cover crawler GETs. No raw IPs or unbounded source map. */
export class AnalyticsIngress {
  private checkedAt = -Infinity;
  private capacityError = '';
  private usedBytes(){return (Number(this.db.pragma('page_count',{simple:true}))-Number(this.db.pragma('freelist_count',{simple:true})))*Number(this.db.pragma('page_size',{simple:true}));}
  constructor(private db: Database.Database, private root: string, private policy=analyticsIngressPolicy(), private clock=Date.now) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_ingress'").get())db.exec(`CREATE TABLE analytics_ingress(id TEXT PRIMARY KEY,requests INTEGER NOT NULL,events INTEGER NOT NULL,reset_at INTEGER NOT NULL);
      CREATE INDEX analytics_ingress_expiry ON analytics_ingress(reset_at);`);
  }
  status(){
    const clock=this.clock();let reason='',bytes=0,freeBytes=0;
    try{this.capacity(clock);}catch(error:any){reason=error.message;}
    try{const disk=statfsSync(this.root);freeBytes=disk.bavail*disk.bsize;for(const suffix of ['','-wal','-shm']){const path=join(this.root,'analytics.sqlite'+suffix);try{bytes+=statSync(path).size;}catch(error:any){if(error.code!=='ENOENT')throw error;}}}catch{reason||='无法核实磁盘容量。';}
    const today=this.db.prepare("SELECT events,reset_at FROM analytics_ingress WHERE id='all:day' AND reset_at>?").get(clock) as {events:number;reset_at:number}|undefined;
    if((today?.events??0)>=this.policy.dailyEvents)reason||='今日统计采集已达到数量上限，次日自动恢复。';
    return {collecting:!reason,reason,bytes:this.usedBytes(),allocatedBytes:bytes,maximumBytes:this.policy.maximumBytes,freeBytes,minimumFreeBytes:this.policy.minimumFreeBytes,dailyEvents:today?.events??0,dailyLimit:this.policy.dailyEvents,resetAt:today?.reset_at??null};
  }
  private capacity(now: number) {
    if(now-this.checkedAt>=1000 || now<this.checkedAt) {
      this.checkedAt=now;
      try {
        const fs=statfsSync(this.root);
        const bytes=this.usedBytes();
        this.capacityError=fs.bavail*fs.bsize<this.policy.minimumFreeBytes?'统计采集已暂停：磁盘剩余空间不足。':bytes>=this.policy.maximumBytes?'统计采集已暂停：统计数据库已达到容量上限。':'';
      }catch{this.capacityError='统计采集已暂停：无法核实磁盘容量。';}
    }
    if(this.capacityError) throw new WeavaError(this.capacityError,503,{retryAfter:60,retryAt:now+60000});
  }
  reserve(network: string, events: number) {
    if(!Number.isSafeInteger(events)||events<0||events>100) throw new WeavaError('统计事件数量无效。');
    const now=this.clock();
    this.capacity(now);
    const key=createHash('sha256').update(network||'unknown').digest('hex');
    const minute=(Math.floor(now/60000)+1)*60000,day=(Math.floor(now/86400000)+1)*86400000;
    const budgets=[
      {id:'all:minute',requests:this.policy.globalRequests,events:this.policy.globalEvents,reset:minute},
      {id:'all:day',requests:this.policy.dailyEvents,events:this.policy.dailyEvents,reset:day},
      {id:'source:minute:'+key,requests:this.policy.sourceRequests,events:this.policy.sourceEvents,reset:minute},
      {id:'source:day:'+key,requests:this.policy.sourceDailyEvents,events:this.policy.sourceDailyEvents,reset:day},
    ];
    this.db.transaction(()=>{
      this.db.prepare('DELETE FROM analytics_ingress WHERE reset_at<=?').run(now);
      for(const budget of budgets) {
        const row=this.db.prepare('SELECT requests,events FROM analytics_ingress WHERE id=?').get(budget.id) as {requests:number;events:number}|undefined;
        if((row?.requests??0)+1>budget.requests||(row?.events??0)+events>budget.events) {
          throw new WeavaError('统计采集过于频繁，请稍后重试。',429,{retryAfter:Math.max(1,Math.ceil((budget.reset-now)/1000)),retryAt:budget.reset});
        }
      }
      // Expired entries are reused; distributed clients cannot grow bookkeeping indefinitely.
      const missing=budgets.filter(budget=>!this.db.prepare('SELECT 1 FROM analytics_ingress WHERE id=?').get(budget.id)).length;
      const count=(this.db.prepare('SELECT COUNT(*) n FROM analytics_ingress').get() as {n:number}).n;
      if(count+missing>this.policy.maximumSources*2+2) throw new WeavaError('统计采集来源过多，请稍后重试。',429,{retryAfter:60,retryAt:now+60000});
      const write=this.db.prepare('INSERT INTO analytics_ingress VALUES(?,1,?,?) ON CONFLICT(id) DO UPDATE SET requests=requests+1,events=events+excluded.events');
      for(const budget of budgets) write.run(budget.id,events,budget.reset);
    }).immediate();
  }
}
