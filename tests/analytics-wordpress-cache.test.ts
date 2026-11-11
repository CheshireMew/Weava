import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({paths:[{id:'article',path:'/changed/'}],sql:[] as string[]}));
vi.mock('better-sqlite3',()=>({default:class {prepare(sql:string){mocks.sql.push(sql);return {all:()=>mocks.paths};}close(){}}}));
import {wordpressLifetime,mergeWordpressAnalytics} from '../packages/core/src/analytics-wordpress.ts';
it('reuses unchanged imported totals and refreshes both snapshot replacements and article path changes',()=>{
 let fingerprint='first';
 const tables:any={pages:[{id:1,uri:'/original/',views:10},{id:2,uri:'https://old.example/original/',views:4}],visitors:[{id:1,hits:14}],relationships:[{pageId:1,visitorId:1}],historical:[{category:'uri',uri:'/original/',value:6},{category:'visits',value:6},{category:'visitors',value:1}],daily:[],events:[]};
 const rows=vi.fn((table:string)=>tables[table].map((row:any)=>({data:JSON.stringify(row)})));
 const db:any={name:'D:/test/analytics.sqlite',prepare:(sql:string)=>({get:()=>({exists:1}),all:(_fingerprint:string,table:string)=>sql.includes('JOIN wp_statistics_snapshots')?[{source_id:'imported',fingerprint,metadata:JSON.stringify({mapping:[{id:1,entryId:'article',path:'/original/'}],source:{timezone:'UTC'}})}]:rows(table)})};
 const first=wordpressLifetime(db)!;
 expect(first.views).toBe(20);expect(first.visitors).toBe(2);expect(first.entries.get('article')).toBe(16);expect(first.pages.get('/changed/')).toBe(16);
 first.entries.clear(); // Callers cannot corrupt the cached total maps.
 expect(wordpressLifetime(db)!.entries.get('article')).toBe(16);expect(rows).toHaveBeenCalledTimes(6);
 expect(wordpressLifetime(db,'/changed/')).toMatchObject({views:16,visitors:1});
 mocks.paths=[{id:'article',path:'/renamed/'}];expect(wordpressLifetime(db)!.pages.get('/renamed/')).toBe(16);expect(rows).toHaveBeenCalledTimes(12);
 tables.pages[0].views=20;fingerprint='replacement';expect(wordpressLifetime(db)!.entries.get('article')).toBe(26);expect(rows).toHaveBeenCalledTimes(18);
 expect(mocks.sql.every(sql=>sql.includes('entry_list'))).toBe(true);
});
it('recovers external referrals from imported direct records and excludes unattributed records from sources',()=>{
 const tables:any={pages:[],relationships:[],daily:[],historical:[],events:[],visitors:[
  {id:1,day:'2026-11-01',referrer:'www.google.com',sourceChannel:'search',sourceName:'Google',hits:38},
  {id:2,day:'2026-11-01',referrer:'www.google.com.hk',sourceChannel:'direct',sourceName:'Direct',hits:31},
  {id:3,day:'2026-11-01',referrer:'',sourceChannel:'direct',sourceName:'Direct',hits:2},
  {id:4,day:'2026-11-01',referrer:'blog.example.test',sourceChannel:'direct',sourceName:'Direct',hits:3},
 ]};
 const db:any={name:'D:/test/analytics.sqlite',prepare:(sql:string)=>({get:()=>({exists:1}),all:(_fingerprint:string,table:string)=>sql.includes('JOIN wp_statistics_snapshots')?[{source_id:'google-history',fingerprint:'google-history',metadata:JSON.stringify({mapping:[],source:{siteUrl:'https://blog.example.test',timezone:'UTC'}})}]:tables[table].map((row:any)=>({data:JSON.stringify(row)}))})};
 const native:any={range:{start:'2026-11-01',end:'2026-11-01',previousStart:'2026-10-31',previousEnd:'2026-10-31',days:1},views:28,visitors:13,sessions:28,previous:{views:0,visitors:0,sessions:0},lifetime:{views:28,visitors:13,sessions:28},averageActiveMs:1000,daily:[],overview:[],pages:[],sources:[{channel:'search-referral',host:'google.com',name:'Google',views:28,sessions:28,visitors:13}],engines:[],recentVisitors:[],activeVisitors:[],actions:[],countries:[],browsers:[],operatingSystems:[],devices:[],models:[],lifetimePages:[]};
 const report=mergeWordpressAnalytics(db,native,new URLSearchParams());
 expect(report.sources).toEqual([{channel:'search-referral',host:null,name:'Google',views:97,sessions:null,visitors:15}]);
 expect(report).toMatchObject({views:102,visitors:17});
 expect(native.sources[0]).toMatchObject({views:28,sessions:28,visitors:13});
 expect(mergeWordpressAnalytics(db,native,new URLSearchParams()).sources).toEqual(report.sources);
 expect(mergeWordpressAnalytics(db,native,new URLSearchParams({channel:'paid'})).sources).toEqual(native.sources);
});
it.each([
 ['Bing','www.bing.com','cn.bing.com'],['Google','google.com','google.co.jp'],['百度','baidu.com','m.baidu.com'],
 ['DuckDuckGo','duckduckgo.com','www.duckduckgo.com'],['Yahoo','search.yahoo.com','search.yahoo.co.jp'],['Yandex','yandex.com','yandex.ru'],
 ['搜狗','sogou.com','m.sogou.com'],['360','so.com','www.so.com'],['ChatGPT','chat.openai.com','chatgpt.com'],
])('merges imported %s labels and domain aliases into its current source and trend', (name,host,alternate)=>{
 const channel=name==='ChatGPT'?'ai-referral':'search-referral';
 const tables:any={pages:[],relationships:[],daily:[],historical:[],events:[],visitors:[
  {id:1,day:'2026-11-01',referrer:host,sourceChannel:'search',sourceName:name.toLowerCase(),hits:4},
  {id:2,day:'2026-11-01',referrer:alternate,sourceChannel:'organic',sourceName:alternate,hits:5},
  {id:3,day:'2026-11-01',referrer:'',sourceChannel:'search',sourceName:name,hits:6},
 ]};
 const db:any={name:'D:/test/analytics.sqlite',prepare:(sql:string)=>({get:()=>({exists:1}),all:(_fingerprint:string,table:string)=>sql.includes('JOIN wp_statistics_snapshots')?[{source_id:name+'-history',fingerprint:name+'-aliases',metadata:JSON.stringify({mapping:[],source:{timezone:'UTC'}})}]:tables[table].map((row:any)=>({data:JSON.stringify(row)}))})};
 const native:any={range:{start:'2026-11-01',end:'2026-11-01',previousStart:'2026-10-31',previousEnd:'2026-10-31',days:1},views:2,visitors:1,sessions:2,previous:{views:0,visitors:0,sessions:0},lifetime:{views:2,visitors:1,sessions:2},daily:[],overview:[],pages:[],sources:[{channel,host,name,views:2,sessions:2,visitors:1}],engines:[{name,channel,views:2,sessions:2,daily:[{date:'2026-11-01',views:2,sessions:2}],previousViews:0,previousSessions:0,previousDaily:[]}],recentVisitors:[],activeVisitors:[],actions:[],countries:[],browsers:[],operatingSystems:[],devices:[],models:[],lifetimePages:[]};
 const report=mergeWordpressAnalytics(db,native,new URLSearchParams());
 expect(report.sources).toEqual([{channel,host:null,name,views:17,sessions:null,visitors:4}]);
 expect(report.engines).toHaveLength(1);expect(report.engines[0]).toMatchObject({name,views:17,daily:[{date:'2026-11-01',views:17,sessions:null}]});
});
