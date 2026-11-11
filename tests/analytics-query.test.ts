import { expect,it } from 'vitest';
import { analyticsDatabase } from './fixtures/analytics-database.ts';
import { analyticsReport } from '../packages/core/src/analytics-reports.ts';
import { analyticsReport as reference } from './fixtures/analytics-reference.ts';
import { Analytics } from '../packages/core/src/analytics.ts';

function normalized(value:any):any{
  if(Array.isArray(value))return value.map(normalized).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])]));
  return value;
}
it('matches the previous report semantics for attributed sessions, filters, actions, legacy identities and DST boundaries',()=>{
  const db=analyticsDatabase();
  try{
    const insert=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)'),detail=db.prepare('INSERT INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'),activity=db.prepare('INSERT INTO page_activity VALUES(?,?,?,?,?)');
    db.transaction(()=>{
      for(let i=0;i<180;i++){
        const id='event-'+String(i).padStart(4,'0'),kind=['view','view','click','event'][i%4],at=new Date(Date.UTC(2026,9,30)+i%6*86400000+Math.floor(i/6)*23000).toISOString();
        insert.run(id,kind,at,['/one/','/two/','/中文/'][i%3],i%11===0?'':'visitor-'+i%13,i%17===0?'':'session-'+i%7,'https://target.test/'+i%5,kind==='event'?'share:success':'Label '+i%3,'body',['google.com','chatgpt.com','','ref.example'][i%4],'release');
        if(i%7!==0)detail.run(id,i%3?'CN':'',i%5?'Chrome':'Safari',i%5?'Windows':'iOS',i%5?'desktop':'smartphone',i%5?'PC':'iPhone','zh',i%9===0?'ai-referral':'',i%9===0?'ChatGPT':'',i%9===0?'campaign':'','referral',i%9===0?'launch':'',1);
        if(kind==='view')activity.run(id,at,i*111,i%101,i%3===0?0:1);
      }
    })();
    const clock=Date.UTC(2026,10,3,12);
    // Starting on actions avoids session attribution until a later section needs it.
    const lazy=new URLSearchParams({start:'2026-10-31',end:'2026-11-03',section:'actions'});
    const actions=analyticsReport(db,lazy,'UTC',clock),full=reference(db,lazy,'UTC',clock);
    for(const key of ['views','visitors','sessions','clicks','previous','overview','lifetime','links','actions'] as const)expect(normalized(actions[key])).toEqual(normalized(full[key]));
    db.prepare("UPDATE events SET label='changed after actions' WHERE id='event-0003'").run();
    lazy.delete('section');expect(normalized(analyticsReport(db,lazy,'UTC',clock))).toEqual(normalized(reference(db,lazy,'UTC',clock)));
    const check=()=>{
      const selections:Record<string,string>[]=[{},{path:'/two/'},{country:'未知'},{channel:'ai-referral'},{device:'smartphone'},{country:'CN',browser:'Chrome'}];
      for(const timezone of ['Asia/Shanghai','America/New_York','UTC'])for(const filters of selections){
        const params=new URLSearchParams({start:'2026-11-01',end:'2026-11-03',...filters});
        expect(normalized(analyticsReport(db,params,timezone,clock)),JSON.stringify({timezone,filters})).toEqual(normalized(reference(db,params,timezone,clock)));
      }
    };
    check();
    const incremental=new URLSearchParams({start:'2026-11-01',end:'2026-11-03'});
    analyticsReport(db,incremental,'UTC',clock);
    db.prepare("UPDATE events SET ts='2026-10-29T00:00:00.000Z',path='/two/',visitor='moved',session='new-session' WHERE id='event-0001'").run();
    db.prepare("UPDATE events SET kind='click' WHERE id='event-0004'").run();
    db.prepare("DELETE FROM events WHERE id='event-0000'").run();
    db.prepare("DELETE FROM event_context WHERE event_id='event-0021'").run();
    db.prepare("DELETE FROM page_activity WHERE view_id='event-0025'").run();
    expect(normalized(analyticsReport(db,incremental,'UTC',clock))).toEqual(normalized(reference(db,incremental,'UTC',clock)));
    check();
    db.transaction(()=>{for(let index=0;index<11000;index++)insert.run('outside-'+index,'event','2020-01-01T00:00:00.000Z','/outside/','other','other','','action','','','old');})();
    expect((db.prepare('SELECT COUNT(*) n FROM analytics_changes').get() as {n:number}).n).toBeLessThanOrEqual(10256);
    expect(normalized(analyticsReport(db,incremental,'UTC',clock))).toEqual(normalized(reference(db,incremental,'UTC',clock)));
  }finally{db.close();}
},30000);
it('groups Google domains and campaign variants once while counting each visitor only once',()=>{
  const db=analyticsDatabase();
  try{
    const insert=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const context=db.prepare('INSERT INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const visits=[
      ['one','reader','first','www.google.com','search-referral','','','','/one/'],
      ['two','reader','second','www.google.com.hk','search-referral','','organic','launch','/two/'],
      ['three','other','third','google.co.jp','search-referral','','organic','another','/one/'],
      ['paid','paid-reader','paid','google.com','paid','Google','cpc','advertisement','/one/'],
      ['custom','custom-reader','custom','google.com','search-referral','newsletter','organic','special','/one/'],
    ];
    for(const [id,visitor,session,host,channel,source,medium,campaign,path] of visits){
      insert.run(id,'view','2026-11-01T12:00:00.000Z',path,visitor,session,'','','',host,'release');
      context.run(id,'','Chrome','Windows','desktop','','',channel,'Google',source,medium,campaign,1);
    }
    const params=new URLSearchParams({start:'2026-11-01',end:'2026-11-01',section:'sources'}),clock=Date.UTC(2026,10,2);
    const result=analyticsReport(db,params,'UTC',clock);
    const google=result.sources.filter(row=>row.name==='Google'&&row.channel==='search-referral');
    expect(google).toEqual([{name:'Google',channel:'search-referral',host:null,views:3,sessions:3,visitors:2}]);
    expect(result.sources.find(row=>row.channel==='paid')).toMatchObject({name:'Google',views:1,visitors:1});
    expect(result.sources.find(row=>row.name==='newsletter')).toMatchObject({views:1,visitors:1});
    expect(result.campaigns.map(row=>row.campaign)).toEqual(expect.arrayContaining(['launch','another']));
    expect(analyticsReport(db,new URLSearchParams({...Object.fromEntries(params),path:'/one/'}),'UTC',clock).sources.find(row=>row.name==='Google'&&row.channel==='search-referral')).toMatchObject({views:2,sessions:2,visitors:2});
  }finally{db.close();}
});
it('merges ChatGPT referrers and tracked links without merging paid traffic',()=>{
  const db=analyticsDatabase();
  try{
    const insert=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const context=db.prepare('INSERT INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const visits=[
      ['legacy','reader','chat.openai.com','search-referral','ChatGPT','',''],
      ['tagged','reader','','campaign','','chatgpt.com',''],
      ['referrer','other','chatgpt.com','ai-referral','ChatGPT','',''],
      ['paid','paid-reader','','paid','','ChatGPT','cpc'],
      ['unknown','direct-reader','','direct-or-unknown','','',''],
      ['recovered','bing-reader','www.bing.com','direct-or-unknown','','(direct)',''],
      ['email','unknown-reader','','email','','(not set)','email'],
    ];
    for(const [id,visitor,host,channel,engine,source,medium] of visits){
      insert.run(id,'view','2026-11-01T12:00:00.000Z','/one/',visitor,id,'','','',host,'release');
      context.run(id,'','Chrome','Windows','desktop','','',channel,engine,source,medium,'',1);
    }
    const params=new URLSearchParams({start:'2026-11-01',end:'2026-11-01'}), clock=Date.UTC(2026,10,2);
    const report=analyticsReport(db,params,'UTC',clock);
    expect(report.sources).toHaveLength(3);
    expect(report).toMatchObject({views:7,visitors:6});
    expect(report.sources.find(row=>row.channel==='ai-referral')).toEqual({name:'ChatGPT',channel:'ai-referral',host:null,views:3,sessions:3,visitors:2});
    expect(report.sources.find(row=>row.channel==='paid')).toMatchObject({name:'ChatGPT',views:1,visitors:1});
    expect(report.sources.find(row=>row.name==='Bing')).toMatchObject({channel:'search-referral',views:1,visitors:1});
    const csv=Analytics.prototype.export.call({report:()=>report} as any,new URLSearchParams({dataset:'sources'}),'UTC');
    expect(csv.split('\n').filter(Boolean)).toHaveLength(4);
    expect(csv).not.toMatch(/直接 \/ 未知|not set/);
    expect(report.campaigns).toContainEqual(expect.objectContaining({source:'chatgpt.com',views:1}));
    params.set('channel','ai-referral');
    const filtered=analyticsReport(db,params,'UTC',clock);
    expect(filtered.engines).toEqual([expect.objectContaining({name:'ChatGPT',views:3})]);
    expect(filtered.recentVisitors).toEqual([
      expect.objectContaining({source:'ChatGPT',channel:'ai-referral'}),
      expect.objectContaining({source:'ChatGPT',channel:'ai-referral'}),
    ]);
  }finally{db.close();}
});
it.each([
  ['Bing',['www.bing.com','cn.bing.com','bing.com']],
  ['Google',['google.com','www.google.com.hk','google.co.jp']],
  ['百度',['www.baidu.com','m.baidu.com','baidu.com']],
  ['DuckDuckGo',['duckduckgo.com','www.duckduckgo.com','start.duckduckgo.com']],
  ['Yahoo',['search.yahoo.com','uk.search.yahoo.com','search.yahoo.co.jp']],
  ['Yandex',['yandex.com','www.yandex.ru','yandex.ru']],
  ['搜狗',['www.sogou.com','m.sogou.com','sogou.com']],
  ['360',['www.so.com','m.so.com','so.com']],
])('groups %s aliases before counting visitors, rendering trends, and exporting', (engine,hosts)=>{
  const db=analyticsDatabase();
  try{
    const insert=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)'),context=db.prepare('INSERT INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    hosts.forEach((host,index)=>{
      const id='provider-'+index;insert.run(id,'view','2026-11-01T12:00:00.000Z','/one/',index===2?'other':'reader','session-'+index,'','','',host,'release');
      context.run(id,'','Chrome','Windows','desktop','','','search-referral','',index===0?'':index===1?engine.toLowerCase():host,'organic','',1);
    });
    for(const [id,channel,source] of [['paid','paid',engine],['custom','search-referral','newsletter']]){
      insert.run(id,'view','2026-11-01T12:00:00.000Z','/one/',id,id,'','','',hosts[0],'release');
      context.run(id,'','Chrome','Windows','desktop','','',channel,engine,source,channel==='paid'?'cpc':'organic','launch',1);
    }
    const params=new URLSearchParams({start:'2026-11-01',end:'2026-11-01',section:'sources'});
    const report=analyticsReport(db,params,'UTC',Date.UTC(2026,10,2));
    expect(report.sources.filter(row=>row.name===engine&&row.channel==='search-referral')).toEqual([{name:engine,channel:'search-referral',host:null,views:3,sessions:3,visitors:2}]);
    expect(report.sources.find(row=>row.name==='newsletter')).toMatchObject({views:1,visitors:1});
    expect(report.sources.find(row=>row.channel==='paid')).toMatchObject({name:engine,views:1});
    expect(report.engines).toHaveLength(1);expect(report.engines[0]).toMatchObject({name:engine,views:5});
    const exported=Analytics.prototype.export.call({report:()=>report} as any,new URLSearchParams({dataset:'sources'}),'UTC');
    expect(exported.split('\n').filter(line=>line.startsWith('"search-referral",')&&line.includes(',"'+engine+'",'))).toHaveLength(1);
  }finally{db.close();}
});
