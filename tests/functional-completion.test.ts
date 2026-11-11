import Database from 'better-sqlite3';
import {afterEach,expect,it} from 'vitest';
import {entrySchema,defaultSettings,zonedDateTime,zonedInstants,type Release} from '@weava/contracts';
import {migrateStorage} from '../packages/core/src/storage-migrations.ts';
import {SCHEMA_VERSION} from '../packages/core/src/schema-version.ts';
import {indexListRecord} from '../packages/core/src/list-index.ts';
import {queryDrafts} from '../packages/core/src/query.ts';
import {queryPublicCatalog} from '../packages/core/src/public-query.ts';
import {storeRelease} from '../packages/core/src/publication-store.ts';
import {searchPresentation} from '../packages/core/src/search-presentation.ts';
import {publicDocumentResponse} from '../apps/web/src/public-documents.ts';
import {replaceMediaUrls} from '../packages/core/src/media-replacement.ts';
import {appendSiteEvent,registerEventConsumer,claimSiteEvents,finishSiteEvents,retrySiteEvents,readSiteEvents} from '../packages/core/src/site-events.ts';
import {Engagement} from '../packages/core/src/engagement.ts';
import {migrateAnalyticsDiscovery,collectSearch,discoveryReport} from '../packages/core/src/analytics-discovery.ts';
import {AnalyticsIngress} from '../packages/core/src/analytics-ingress.ts';
import {assertUploadSize} from '../packages/core/src/media-upload-policy.ts';
import {defaultMediaUploadLimits} from '@weava/contracts';
import {commentsHandlers} from '../apps/web/src/api/comments.ts';
import {adminEntry} from '../packages/core/src/admin-content.ts';
const databases:Database.Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){
  const db=new Database(':memory:');databases.push(db);migrateStorage(db,'unused',0);
  const type={id:'post',label:'文章',pathPrefix:'/posts/',template:'article',fields:[]};
  const site={store:{raw:db,list:()=>[{id:type.id,value:type}]},terms:()=>[]} as any;
  const entry=entrySchema.parse({id:'first',kind:'content',type:'post',title:'精确中文搜索',path:'/posts/first/',document:{version:1,format:'markdown',source:'正文独有词 **needle** <script>unsearchable</script>'}});
  return {db,site,type,entry};
}
it('resolves site time independently of machine timezone and rejects DST gaps and ambiguity',()=>{
  expect(zonedDateTime('2026-11-11T09:00','Asia/Shanghai')).toBe('2026-11-11T01:00:00.000Z');
  expect(zonedInstants('2026-03-08T02:30','America/New_York')).toEqual([]);
  expect(()=>zonedDateTime('2026-03-08T02:30','America/New_York')).toThrow(/不存在/);
  expect(zonedInstants('2026-11-01T01:30','America/New_York')).toEqual(['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z']);
  expect(()=>zonedDateTime('2026-11-01T01:30','America/New_York')).toThrow(/两次/);
  expect(zonedDateTime('2026-11-01T01:30','America/New_York','later')).toBe('2026-11-01T06:30:00.000Z');
  expect(()=>zonedDateTime('2026-02-30T09:00','UTC')).toThrow(/无效/);
});
it('indexes the active draft body for text and block documents and removes replaced words',()=>{
  const {db,site,entry}=fixture();
  indexListRecord(db,'entry',entry.id,entry,1,'');
  expect(queryDrafts(site,{query:'正文独有词'}).total).toBe(1);
  expect(queryDrafts(site,{query:'needle'}).total).toBe(1);
  expect(queryDrafts(site,{query:'unsearchable'}).total).toBe(0);
  indexListRecord(db,'entry',entry.id,{...entry,blocks:[{id:'text',type:'text',props:{text:'替代区块词'}}]},2,'');
  expect(queryDrafts(site,{query:'needle'}).total).toBe(0);
  expect(queryDrafts(site,{query:'替代区块词'}).total).toBe(1);
  expect(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({v:SCHEMA_VERSION});
});
it('ranks title matches first and paginates actual full-text matches with safe snippets',()=>{
  const {db,entry,type}=fixture();
  const entries=Array.from({length:23},(_,i)=>({...entry,id:'article-'+i,path:'/posts/'+i+'/',title:i===22?'needle title':'Other '+i,html:'<p>needle body &amp; &lt;tag&gt;</p>',revisionId:i+1,modifiedAt:'2026-11-01T00:00:00Z'}));
  const release:Release={id:'published',label:'test',createdAt:'2026-11-01T00:00:00Z',settings:defaultSettings,types:[type],entries};
  storeRelease(db,release);
  const first=queryPublicCatalog(db,release,{query:'needle',pageSize:20},true);
  expect(first).toMatchObject({total:23,pages:2});expect(first.items[0].id).toBe('article-22');
  expect(queryPublicCatalog(db,release,{query:'needle',page:2,pageSize:20},true).items).toHaveLength(3);
  const text=searchPresentation(entries[0],'needle');
  expect(text.snippet).toContain('<mark>needle</mark>');expect(text.snippet).toContain('&lt;tag&gt;');expect(text.snippet).not.toContain('<tag>');
});
it('emits RSS full bodies only when selected and resolves relative links without exposing private entries',async()=>{
  const {entry,type}=fixture();
  const item={...entry,status:'published' as const,html:'<p>Complete body<img src="/media/photo.png"><a href="/target/">link</a></p>',revisionId:1,modifiedAt:'2026-11-01T00:00:00Z'};
  const release:Release={id:'rss',label:'test',createdAt:item.modifiedAt,settings:{...defaultSettings,domain:'https://example.com/',rssMode:'full'},types:[type],entries:[item,{...item,id:'private',visibility:'private',html:'Secret body'}]};
  const response=()=>publicDocumentResponse(release,new URL('https://example.com/rss.xml'))!.text();
  expect(await response()).toContain('https://example.com/media/photo.png');expect(await response()).not.toContain('Secret body');
  release.entries[0]={...item,rssMode:'summary'};expect(await response()).not.toContain('Complete body');
  release.settings.rssMode='summary';release.entries[0]={...item,rssMode:'full'};expect(await response()).toContain('Complete body');
});
it('filters scheduled and failed entries without confusing their current publication state',()=>{
  const {db,site,entry}=fixture();indexListRecord(db,'entry',entry.id,entry,1,'');
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run('publication-schedule','s',2,JSON.stringify({entryId:entry.id,status:'scheduled',dueAt:'2026-12-01T01:00:00Z'}),'');
  expect(queryDrafts(site,{status:'scheduled'}).items[0].schedules?.[0]).toMatchObject({id:'s',revision:2,status:'scheduled'});
  expect(queryDrafts(site,{status:'schedule-failed'}).total).toBe(0);
  db.prepare("UPDATE records SET data=json_set(data,'$.status','failed','$.error','renderer failed') WHERE scope='publication-schedule'").run();
  expect(queryDrafts(site,{status:'schedule-failed'}).items[0].schedules?.[0].error).toBe('renderer failed');
});
it('partitions article groups without hiding changed publications, running schedules or failed drafts',()=>{
  const {db,site,entry}=fixture();
  const published=['published','changed','published-update'];
  const scheduled=['scheduled','running'];
  const drafts=['draft','archived','failed','cancelled'];
  for(const id of [...published,...scheduled,...drafts]) {
    indexListRecord(db,'entry',id,{...entry,id,title:id,status:id==='archived'?'archived':'draft'},2,'2026-11-11T00:00:00Z');
    if(published.includes(id))db.prepare('INSERT INTO published_entry_revisions VALUES(?,?,?)').run('active',id,id==='changed'?1:2);
    if(['scheduled','running','failed','cancelled','published-update'].includes(id))db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run('publication-schedule',id,1,JSON.stringify({entryId:id,status:id==='published-update'?'scheduled':id,dueAt:'2026-12-01T01:00:00Z'}),'');
  }
  db.prepare("INSERT INTO state(key,value) VALUES('release','active') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const ids=(group:'published'|'scheduled'|'draft')=>queryDrafts(site,{kind:'content',format:'article',group}).items.map(row=>row.id).sort();
  expect(ids('published')).toEqual(published.sort());expect(ids('scheduled')).toEqual(scheduled.sort());expect(ids('draft')).toEqual(drafts.sort());
  expect(queryDrafts(site,{group:'draft',query:'failed'}).items[0].schedules?.[0].status).toBe('failed');
  expect(queryDrafts(site,{group:'published',pageSize:1,page:2})).toMatchObject({total:3,pages:3,items:[{id:'published'}]});
});
it('replaces exact media destinations across Markdown, HTML and fields while retaining similarly named files',()=>{
  const value={body:'![Image](/media/old.png) <img src="/media/old.png"> <a href="https://site.test/media/old.png#part">link</a> ![](/media/old.png-other.png)',fields:{image:'/media/old.png'},cover:'/media/old.png?size=large'};
  const result=replaceMediaUrls(value,'/media/old.png','/media/new.png','https://site.test');
  expect(result.count).toBe(5);expect(result.value.body).toContain('/media/old.png-other.png');expect(result.value.cover).toBe('/media/new.png?size=large');expect(result.value.fields.image).toBe('/media/new.png');expect(value.fields.image).toBe('/media/old.png');
  const examples='`/media/old.png`\n\n```html\n<img src="/media/old.png">\n```\n\n<pre>/media/old.png</pre>\n\n![live](/media/old.png)';
  const protectedResult=replaceMediaUrls(examples,'/media/old.png','/media/new.png','https://site.test');
  expect(protectedResult.count).toBe(1);expect(protectedResult.value).toBe(examples.replace('![live](/media/old.png)','![live](/media/new.png)'));
});
it('reports publication from the active release even when the editable record is a draft',()=>{
  const {db,site,entry}=fixture();let revision=1;
  site.store.get=()=>({id:entry.id,revision,updatedAt:'',value:entry});
  expect(adminEntry(site,entry.id).published).toBe(false);
  db.prepare('INSERT INTO published_entry_revisions VALUES(?,?,?)').run('active',entry.id,1);
  db.prepare("INSERT INTO state(key,value) VALUES('release','active') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  expect(adminEntry(site,entry.id)).toMatchObject({published:true,hasChanges:false,value:{status:'draft'}});
  revision=2;expect(adminEntry(site,entry.id)).toMatchObject({published:true,hasChanges:true});
  db.prepare('DELETE FROM published_entry_revisions').run();expect(adminEntry(site,entry.id).published).toBe(false);
});
it('leases persistent external events, retries stable identities and rejects stale acknowledgements',()=>{
  const {db}=fixture();appendSiteEvent(db,'backup.failed',{jobId:'job'},'stable-event');appendSiteEvent(db,'backup.failed',{jobId:'job'},'stable-event');
  expect(readSiteEvents(db)).toHaveLength(1);registerEventConsumer(db,'external',0,['backup.failed']);
  const first=claimSiteEvents(db,'external',1000);expect(first.events[0].id).toBe('stable-event');
  expect(()=>claimSiteEvents(db,'external',1001)).toThrow(/正在处理/);
  finishSiteEvents(db,'external',first.token!,'connection lost',2000);expect(()=>claimSiteEvents(db,'external',2001)).toThrow(/等待/);
  retrySiteEvents(db,'external',2002);const second=claimSiteEvents(db,'external',2003);expect(second.events[0].id).toBe(first.events[0].id);
  expect(()=>finishSiteEvents(db,'external',first.token!,undefined,2004)).toThrow(/租约/);
  expect(finishSiteEvents(db,'external',second.token!,undefined,2004).cursor).toBe(second.events[0].seq);
  expect(claimSiteEvents(db,'external',2005).events).toHaveLength(0);
});
it('filters comments and changes a reviewed batch atomically when all expected statuses still match',()=>{
  const {db}=fixture(),engagement=new Engagement(db,'test');
  const insert=db.prepare('INSERT INTO article_comments VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('a','article','r1','network','client-aaaa','Alice','search body','pending','2026-11-01T01:00:00Z');insert.run('b','other','r2','network','client-bbbb','Bob','different','hidden','2026-11-02T01:00:00Z');
  expect(engagement.comments('all',1,{query:'search',author:'ali',entryId:'article',start:'2026-11-01',end:'2026-11-01'}).items.map(row=>row.id)).toEqual(['a']);
  expect(()=>engagement.moderateMany([{id:'a',expectedStatus:'pending'},{id:'b',expectedStatus:'visible'}],'visible')).toThrow(/变化/);
  expect(engagement.comments('pending').total).toBe(1);
  engagement.moderateMany([{id:'a',expectedStatus:'pending'},{id:'b',expectedStatus:'hidden'}],'visible');expect(engagement.comments('visible').total).toBe(2);
});
it('finds comments by article title, path, author or body through the single search field',async()=>{
  const {db,site,entry}=fixture();indexListRecord(db,'entry',entry.id,entry,1,'');
  site.store.get=(_scope:string,id:string)=>id===entry.id?{value:entry}:null;
  const insert=db.prepare('INSERT INTO article_comments VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('a',entry.id,'r1','net','client-aaaa','Alice','useful response','pending','2026-11-01T01:00:00Z');
  insert.run('b','other','r2','net','client-bbbb','Bob','unrelated','visible','2026-11-02T01:00:00Z');
  const handler=commentsHandlers({site,engagement:new Engagement(db,'test')}).comments;
  for(const q of [entry.title,'/posts/first/','Alice','useful']){
    const result=await handler({query:{q}} as any,{url:new URL('https://example.com/?status=pending')} as any);
    expect(result.total).toBe(1);expect(result.items.map(row=>row.id)).toEqual(['a']);expect(result.items[0].title).toBe(entry.title);
  }
});
it('records search results and successful result clicks once and keeps 404 aggregates separate',()=>{
  const {db}=fixture();migrateAnalyticsDiscovery(db);const allowed=new Set(['/article/']);
  const search={id:'search-id',kind:'search',path:'/search/',query:'  中文搜索 ',total:0};
  expect(collectSearch(db,search,'visitor','session','2026-11-01T01:00:00Z',allowed)).toBe(1);expect(collectSearch(db,search,'visitor','session','2026-11-01T01:00:00Z',allowed)).toBe(0);
  expect(collectSearch(db,{id:'click-id',kind:'search-click',searchId:'search-id',target:'/article/'},'other','session','2026-11-01T01:01:00Z',allowed)).toBe(0);
  expect(collectSearch(db,{id:'click-id',kind:'search-click',searchId:'search-id',target:'/article/'},'visitor','session','2026-11-01T01:01:00Z',allowed)).toBe(1);
  expect(discoveryReport(db,new URLSearchParams('start=2026-11-01&end=2026-11-01'),'UTC').items[0]).toMatchObject({query:'中文搜索',searches:1,emptyResults:1,clickedSearches:1,clicks:1});
  db.prepare('INSERT INTO missing_requests VALUES(?,?,?,?,?)').run('2026-11-01','/old/','https://source.test/',3,'2026-11-01T01:00:00Z');
  expect(discoveryReport(db,new URLSearchParams('start=2026-11-01&end=2026-11-01&dataset=missing'),'UTC').missing[0].requests).toBe(3);
});
it('reports daily collection pauses without consuming another budget and applies media limits by kind',()=>{
  const {db}=fixture(),clock=Date.parse('2026-11-01T00:00:00Z');
  const ingress=new AnalyticsIngress(db,process.cwd(),{sourceRequests:100,sourceEvents:100,globalRequests:100,globalEvents:100,dailyEvents:1,sourceDailyEvents:100,maximumBytes:1073741824,minimumFreeBytes:0,maximumSources:100},()=>clock);
  expect(ingress.status().collecting).toBe(true);ingress.reserve('source',1);expect(ingress.status()).toMatchObject({collecting:false,dailyEvents:1});
  const site={settings:()=>({value:{mediaUploadLimits:{...defaultMediaUploadLimits,video:64*1048576}}})} as any;
  expect(assertUploadSize(site,'video.mp4',40*1048576)).toBe(64*1048576);expect(()=>assertUploadSize(site,'image.png',40*1048576)).toThrow(/32 MB/);
});
