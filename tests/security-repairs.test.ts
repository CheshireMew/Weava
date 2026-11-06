import { afterEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Site } from '../packages/core/src/site.ts';
import { SCHEMA_VERSION } from '../packages/core/src/storage.ts';
import { entrySchema } from '@weava/contracts';
import { entryMediaReferences } from '../packages/core/src/media-references.ts';
import { renderDocument } from '../packages/core/src/documents.ts';
import { archiveHistory, planHistoryArchive, historyArchives } from '../packages/core/src/history-archive.ts';
import { Analytics, csv } from '../packages/core/src/analytics.ts';
import { AnalyticsIngress, analyticsIngressDefaults } from '../packages/core/src/analytics-ingress.ts';
import { assertRequestTransport } from '../packages/core/src/request-safety.ts';
import { requestIdentity } from '../packages/core/src/request-identity.ts';
import { saveLayout } from '../packages/core/src/layouts.ts';

const root=process.env.WEAVA_SECURITY_TEST_ROOT??'D:/Tools/cache/weava/tests/security-repairs-'+Date.now();
const closers:(()=>void)[]=[];
let sequence=0;
const folder=()=>{const path=join(root,String(sequence++));mkdirSync(path,{recursive:true});return path;};
const site=()=>{const value=new Site(folder());closers.push(()=>value.store.raw.open&&value.close());return value;};
const privateEntry=(source:string,format:'html'|'markdown'='markdown')=>entrySchema.parse({id:'private',kind:'page',title:'Private',path:'/private/',status:'published',visibility:'private',document:{version:1,format,source}});
afterEach(()=>{while(closers.length)closers.pop()!();});

it('indexes browser-decoded media URLs in HTML, Markdown, srcset and escaped filenames',()=>{
  for(const entry of [
    privateEntry('![private](&#47;media&#47;secret.png)'),
    privateEntry('<img src="&#x2f;media&#x2f;secret.png?x=1&amp;y=2">','html'),
    privateEntry('<img src="/media/space name.png" srcset="&#47;media&#47;small.png 400w, /media/big.png 800w, /media/name(secret).png 1000w">','html'),
    privateEntry('[file](/media/name\\(secret\\).txt)'),
  ]) {
    const html=renderDocument(entry.document),refs=entryMediaReferences(entry);
    const path=html.includes('space name')?'/media/space%20name.png':html.includes('name(secret)')?'/media/name(secret).txt':'/media/secret.png';
    expect(refs.has(path),html).toBe(true);
    if(html.includes('srcset'))expect([...refs]).toEqual(expect.arrayContaining(['/media/small.png','/media/big.png','/media/name(secret).png']));
  }
});

it('protects entity-encoded private media immediately, retaining the active-public reuse rule',()=>{
  const value=site();mkdirSync(join(value.root,'media'),{recursive:true});writeFileSync(join(value.root,'media','secret.png'),'image');
  const row=value.saveEntry(privateEntry('![private](&#47;media&#47;secret.png)'),null);
  expect(value.isPrivateMedia('/media/secret.png')).toBe(true);
  value.publish();expect(value.visibleRelease()!.entries).toHaveLength(0);
  const pub=value.saveEntry(entrySchema.parse({id:'public',kind:'page',title:'Public',path:'/public/',status:'published',cover:'/media/secret.png'}),null);
  value.publish();expect(value.isPrivateMedia('/media/secret.png')).toBe(false);
  value.saveEntry({...pub.value,cover:''},pub.revision);value.publish();expect(value.isPrivateMedia('/media/secret.png')).toBe(true);
  value.saveEntry({...row.value,document:{version:1,format:'markdown',source:''}},row.revision);expect(value.isPrivateMedia('/media/secret.png')).toBe(true);
});

it('repairs version-11 working drafts, old revisions and archived-only private media without rewriting archives',async()=>{
  const value=site(),path=value.root;
  let row=value.saveEntry(privateEntry('[old](&#47;media&#47;archived.txt)'),null);
  for(let i=0;i<4;i++)row=value.saveEntry({...row.value,title:'revision '+i,document:{version:1,format:'html',source:'<img src="&#47;media&#47;current.png">'}},row.revision);
  const options={before:'2099-01-01',keepRevisions:1,keepReleases:1},plan=planHistoryArchive(value,options);
  const archived=await archiveHistory(value,options,plan.review),manifest=readFileSync(join(archived.path!,'manifest.json'));
  // Reproduce the old index, where the immutable archive also lacked remembered paths.
  value.store.raw.exec("DELETE FROM private_media_paths;DELETE FROM authored_media_refs;DELETE FROM revision_media_refs;DELETE FROM schema_migrations WHERE version>=12;UPDATE records SET data=json_set(data,'$.privateMedia',json('[]')) WHERE scope='history-archive';");
  value.close();
  const repaired=new Site(path,{mode:'migrate'});closers.push(()=>repaired.store.raw.open&&repaired.close());
  expect(repaired.isPrivateMedia('/media/current.png')).toBe(true);
  expect(repaired.isPrivateMedia('/media/archived.txt')).toBe(true);
  expect(repaired.store.raw.prepare('SELECT MAX(version) n FROM schema_migrations').get()).toEqual({n:SCHEMA_VERSION});
  expect(repaired.store.raw.prepare("SELECT 1 FROM authored_media_refs WHERE path='/media/current.png'").get()).toBeTruthy();
  expect(readFileSync(join(archived.path!,'manifest.json'))).toEqual(manifest);
  expect(historyArchives(repaired)).toHaveLength(1);
  const backups=readdirSync(join(path,'archives/schema-upgrades'));repaired.close();
  const reopened=new Site(path);closers.push(()=>reopened.store.raw.open&&reopened.close());
  expect(readdirSync(join(path,'archives/schema-upgrades'))).toEqual(backups);
});

function guard(policy:Partial<typeof analyticsIngressDefaults>={}) {
  const path=folder(),file=join(path,'analytics.sqlite'),db=new Database(file);
  closers.push(()=>db.open&&db.close());
  return {db,path,file,policy:{...analyticsIngressDefaults,...policy}};
}
it('persists source limits across new connections, rejects whole batches and releases budgets after the window',()=>{
  const f=guard({sourceEvents:3}),clock={now:1800000000000};
  const first=new AnalyticsIngress(f.db,f.path,f.policy,()=>clock.now);first.reserve('8.8.8.8',2);
  const secondDb=new Database(f.file);closers.push(()=>secondDb.close());
  const second=new AnalyticsIngress(secondDb,f.path,f.policy,()=>clock.now);
  expect(()=>second.reserve('8.8.8.8',2)).toThrow(expect.objectContaining({status:429}));
  second.reserve('8.8.8.8',1);
  clock.now+=60000;expect(()=>second.reserve('8.8.8.8',3)).not.toThrow();
});
it('enforces request budgets even when empty or duplicate batches consume no new event rows',()=>{
  const f=guard({sourceRequests:2,globalRequests:3}),ingress=new AnalyticsIngress(f.db,f.path,f.policy);
  ingress.reserve('client-a',0);ingress.reserve('client-a',0);
  expect(()=>ingress.reserve('client-a',0)).toThrow(expect.objectContaining({status:429}));
  ingress.reserve('client-b',0);
  expect(()=>ingress.reserve('client-c',0)).toThrow(expect.objectContaining({status:429}));
});
it('repairs archived release objects and their historical template media while leaving the active public release unchanged',async()=>{
  const value=site(),path=value.root;
  for(const name of ['archived.txt','template.png'])writeFileSync(join(path,'media',name),'fixture');
  saveLayout(value,{id:'private-template',kind:'template',label:'Private template',appliesTo:'any',blocks:[{id:'media',type:'compatibility',props:{html:'<img src="&#47;media&#47;template.png">'}},{id:'body',type:'entry-body',props:{}}]},null);
  let row=value.saveEntry({...privateEntry('[old](&#47;media&#47;archived.txt)'),template:'private-template'},null);value.publish();
  row=value.saveEntry({...row.value,title:'Private newer',document:{version:1,format:'markdown',source:''},template:'page'},row.revision);value.publish();
  row=value.saveEntry({...row.value,title:'Public current',visibility:'public'},row.revision);value.publish();
  const active=value.release()!.id,options={before:'2099-01-01',keepRevisions:1,keepReleases:1},plan=planHistoryArchive(value,options);
  const archived=await archiveHistory(value,options,plan.review);expect(archived.releases).toBe(2);
  const immutable=readFileSync(join(archived.path!,'objects.jsonl'));
  value.store.raw.exec("DELETE FROM private_media_paths;DELETE FROM schema_migrations WHERE version>=12;UPDATE records SET data=json_set(data,'$.privateMedia',json('[]')) WHERE scope='history-archive';");
  value.close();const reopened=new Site(path,{mode:'migrate'});closers.push(()=>reopened.store.raw.open&&reopened.close());
  expect(reopened.release()!.id).toBe(active);
  expect(reopened.isPrivateMedia('/media/archived.txt')).toBe(true);
  expect(reopened.isPrivateMedia('/media/template.png')).toBe(true);
  expect(readFileSync(join(archived.path!,'objects.jsonl'))).toEqual(immutable);
});
it('bounds distributed clients, global daily writes and bookkeeping independently',()=>{
  const f=guard({globalEvents:3,dailyEvents:4,maximumSources:2}),clock={now:1800000000000},ingress=new AnalyticsIngress(f.db,f.path,f.policy,()=>clock.now);
  ingress.reserve('client-a',2);
  expect(()=>ingress.reserve('client-b',2)).toThrow(expect.objectContaining({status:429}));
  ingress.reserve('client-b',1);
  expect(()=>ingress.reserve('client-c',0)).toThrow(expect.objectContaining({status:429}));
  expect((f.db.prepare('SELECT COUNT(*) n FROM analytics_ingress').get() as any).n).toBeLessThanOrEqual(6);
  clock.now+=60000;ingress.reserve('client-a',1);
  expect(()=>ingress.reserve('client-b',1)).toThrow(expect.objectContaining({status:429}));
  clock.now+=86400000;expect(()=>ingress.reserve('client-a',3)).not.toThrow();
});
it('stops before writing when disk is low or the database is above its cap, preserving stored data',()=>{
  for(const policy of [{maximumBytes:1},{minimumFreeBytes:Number.MAX_SAFE_INTEGER}]) {
    const f=guard(policy),ingress=new AnalyticsIngress(f.db,f.path,f.policy);
    expect(()=>ingress.reserve('client',1)).toThrow(expect.objectContaining({status:503}));
    expect(f.db.prepare('SELECT COUNT(*) n FROM analytics_ingress').get()).toEqual({n:0});
  }
});
it('limits the real collection path and prevents crawler logging from bypassing exhausted quotas',()=>{
  const path=folder(),a=new Analytics(path);closers.push(()=>a.raw.open&&a.close());
  const batch=(group:number)=>Array.from({length:100},(_,i)=>({id:`security-${group}-${i}`,ts:new Date().toISOString(),kind:'view',path:'/public/',visitor:`reader-${i}`,session:`session-${i}`}));
  for(let i=0;i<6;i++)expect(a.collect(batch(i),'Mozilla/5.0',new Set(['/public/']),{ip:'8.8.8.8'}).accepted).toBe(100);
  expect(()=>a.collect(batch(7),'Mozilla/5.0',new Set(['/public/']),{ip:'8.8.8.8'})).toThrow(expect.objectContaining({status:429}));
  expect(()=>a.recordCrawler('/public/','Googlebot',200,'8.8.8.8')).not.toThrow();
  expect(a.raw.prepare('SELECT COUNT(*) n FROM crawler_requests').get()).toEqual({n:0});
  expect(a.raw.prepare('SELECT COUNT(*) n FROM events').get()).toEqual({n:600});
});
it('exports attacker-controlled campaign data as text while preserving legitimate numeric cells',()=>{
  const a=new Analytics(folder());closers.push(()=>a.raw.open&&a.close());
  a.collect({id:'csv-security-event',kind:'view',path:'/',ts:new Date().toISOString(),campaign:{source:'=1+1',campaign:'CSV audit'}},'Mozilla/5.0',new Set(['/']));
  expect(a.export(new URLSearchParams({dataset:'campaigns'}))).toContain('"\t=1+1"');
  for(const payload of ['=1+1','+1+1','-1+1','@SUM(1)','\r\n=1+1','\u200b=1+1','＝1+1','＋1','－1','＠SUM(1)']) expect(csv([{text:payload}])).toContain('"\t'+payload+'"');
  expect(csv([{number:-10,text:'plain, "quoted"\ntext'}])).toContain('"-10","plain, ""quoted""\ntext"');
});
it('enforces server HTTPS using trusted peer identity, keeping only local bearer tools and health probes usable',()=>{
  const request=new Request('http://localhost/api/admin/v1/account',{headers:{'x-forwarded-proto':'https','x-forwarded-for':'8.8.8.8'}}),policy={enabled:true,trusted:['127.0.0.1']};
  const direct=requestIdentity(request,'203.0.113.4',policy);
  expect(()=>assertRequestTransport(request,direct.secure,'203.0.113.4',false,true)).toThrow();
  expect(()=>assertRequestTransport(request,false,'203.0.113.4',true,true)).toThrow();
  expect(()=>assertRequestTransport(request,true,'127.0.0.1',false,true)).not.toThrow();
  expect(()=>assertRequestTransport(request,false,'127.0.0.1',true,true)).not.toThrow();
  expect(()=>assertRequestTransport(new Request('http://localhost/__health'),false,'127.0.0.1',false,true)).not.toThrow();
  expect(()=>assertRequestTransport(request,false,'127.0.0.1',false,false)).not.toThrow();
});
