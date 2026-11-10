import { expect,it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { Analytics } from '@weava/core';
import { analyticsReport } from '../packages/core/src/analytics-reports.ts';
import { analyticsReport as reference } from './fixtures/analytics-reference.ts';

function normalized(value:any):any{
  if(Array.isArray(value))return value.map(normalized).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])]));
  return value;
}
it('matches the previous report semantics for attributed sessions, filters, actions, legacy identities and DST boundaries',()=>{
  const root=(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/analytics-query-'+Date.now();mkdirSync(root,{recursive:true});const analytics=new Analytics(root),db=analytics.raw;
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
  }finally{analytics.close();}
},30000);
