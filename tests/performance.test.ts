import { afterEach, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readdirSync, writeFileSync,mkdirSync } from 'node:fs';
import { Site, JobRunner, TaskResults, schedulePublication, queueScheduledPublications } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { readPublicationCandidate, preparePublication,commitPublication } from '../packages/core/src/publication.ts';
import { assetResponse } from '../packages/core/src/asset-response.ts';
import { mediaResponse } from '../packages/core/src/media-response.ts';
import { maintenanceReferences } from '../packages/core/src/maintenance-reference-cache.ts';
import { EntryWorkspace } from '../packages/core/src/staged-entries.ts';
import { createBackup,verifyBackup } from '../packages/core/src/backup.ts';
import { wordpressArchiveEntry } from '../packages/core/src/wordpress-archives.ts';

const base='D:/Tools/cache/weava/tests/performance-'+Date.now();
const sites:Site[]=[],runners:JobRunner[]=[];let sequence=0;
function fixture(){const site=new Site(join(base,String(sequence++)));sites.push(site);site.saveType({id:'post',label:'Post',fields:[],pathPrefix:'/posts/',template:'article'},null);return site;}
const entry=(id:string,source='## Heading\n\nText')=>entrySchema.parse({id,title:id,kind:'content',type:'post',path:'/posts/'+id+'/',status:'published',document:{version:1,format:'markdown',source}});
afterEach(()=>{runners.splice(0).forEach(runner=>runner.stop());sites.splice(0).forEach(site=>site.close());});

it('loads a public directory without fetching any entry bodies, then loads only the requested body',()=>{
  const site=fixture();for(let index=0;index<20;index++)site.saveEntry(entry('item-'+index,'Body '.repeat(1000)),null);const published=site.publish();
  const manifest=JSON.parse((site.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(published.id) as any).data);
  const bodyKeys=new Set(manifest.entryKeys),bodyReads:string[]=[];
  const prepare=site.store.raw.prepare.bind(site.store.raw);
  site.store.raw.prepare=((sql:string)=>{
    const statement=prepare(sql);
    if(sql==='SELECT data FROM publication_objects WHERE key=?'){
      const get=statement.get.bind(statement);statement.get=((...args:any[])=>{if(bodyKeys.has(args[0]))bodyReads.push(args[0]);return get(...args);}) as any;
    }
    return statement;
  }) as any;
  const release=site.visibleRelease()!;
  expect(release.entries.map(value=>value.path)).toHaveLength(20);expect(bodyReads).toEqual([]);
  expect(release.entries[7].document.source).toContain('Body');expect(bodyReads).toEqual([manifest.entryKeys[7]]);
  expect(release.entries[7].html).toContain('Body');expect(bodyReads).toHaveLength(1);
});

it('resolves legacy response aliases and missing paths without loading article bodies, including old catalogs',()=>{
  const site=fixture();
  for(let index=0;index<12;index++)site.saveEntry({...entry('route-'+index),source:index===3?{wordpressResponsePath:'/legacy.html/'}:undefined},null);
  const published=site.publish(),manifest=JSON.parse((site.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(published.id) as any).data);
  const check=(target:Site)=>{
    const prepare=target.store.raw.prepare.bind(target.store.raw),reads:string[]=[];
    target.store.raw.prepare=((sql:string)=>{
      const statement=prepare(sql);
      if(sql==='SELECT data FROM publication_objects WHERE key=?'){
        const get=statement.get.bind(statement);statement.get=((key:string)=>{if(manifest.entryKeys.includes(key))reads.push(key);return get(key);}) as any;
      }
      return statement;
    }) as any;
    const release=target.visibleRelease()!;
    for(const path of ['/sitemap.xml','/search/','/missing/'])expect(wordpressArchiveEntry(release,new URL(path,'https://example.test'))).toBeUndefined();
    expect(wordpressArchiveEntry(release,new URL('https://example.test/legacy.html/'))?.id).toBe('route-3');
    expect(reads).toEqual([]);
  };
  check(site);
  const catalog=JSON.parse((site.store.raw.prepare('SELECT data FROM publication_objects WHERE key=?').get(manifest.catalogKey) as any).data);
  for(const item of catalog)delete item.responsePath;
  site.store.raw.prepare('UPDATE publication_objects SET data=? WHERE key=?').run(JSON.stringify(catalog),manifest.catalogKey);
  const legacy=new Site(site.root);sites.push(legacy);check(legacy);
});

it('reuses the reviewed candidate across connections, rejects altered options and leaves the base snapshot unchanged',()=>{
  const site=fixture(),row=site.saveEntry(entry('one'),null),first=site.publish();
  const frozen=JSON.stringify(site.release());
  site.saveEntry({...row.value,title:'Changed'},row.revision);
  const review=site.previewPublication({ids:['one']});
  expect(JSON.stringify(site.release())).toBe(frozen);
  const reopened=new Site(site.root);sites.push(reopened);
  expect(()=>readPublicationCandidate(reopened,{...review.options,ids:['different']})).toThrow(/选项|变化/);
  expect(readPublicationCandidate(reopened,review.options).release.entries[0].title).toBe('Changed');
  expect(reopened.publish(review.options).entries[0].title).toBe('Changed');
  expect(reopened.release(first.id)!.entries[0].title).toBe('one');
});

it('invalidates validation through a transitive content-detail reference',()=>{
  const site=fixture();let target=site.saveEntry(entry('target'),null);
  site.saveEntry({...entry('middle'),blocks:[{id:'target',type:'content-detail',props:{entryId:'target'}}]},null);
  site.saveEntry({...entry('outer'),blocks:[{id:'middle',type:'content-detail',props:{entryId:'middle'}}]},null);
  site.publish();preparePublication(site,{ids:['outer']});
  target=site.saveEntry({...target.value,document:{version:1,format:'markdown',source:'[missing](/does-not-exist/)'}},target.revision);
  expect(()=>preparePublication(site,{ids:[target.id]})).toThrow(/引用无效/);
});
it('serializes and derives publication indexes before acquiring the write transaction',()=>{
  const site=fixture();site.saveEntry(entry('prepared'),null);const prepared=preparePublication(site),value=prepared.release.entries[0],document=value.document;
  let reads=0;Object.defineProperty(value,'document',{enumerable:true,get(){reads++;expect(site.store.raw.inTransaction).toBe(false);return document;}});
  commitPublication(site,prepared);expect(reads).toBeGreaterThan(0);expect(site.release()!.entries[0].document).toEqual(document);
});
it('updates the maintenance reference cache for edits, removed history and appended archives',()=>{
  const site=fixture();let row=site.saveEntry(entry('refs','[a](/media/a.txt)'),null);
  expect(maintenanceReferences(site)).toEqual(new Set(['/media/a.txt']));
  row=site.saveEntry({...row.value,document:{version:1,format:'markdown',source:'[b](/media/b.txt)'}},row.revision);
  expect(maintenanceReferences(site)).toEqual(new Set(['/media/a.txt','/media/b.txt']));
  site.store.raw.prepare("DELETE FROM revisions WHERE scope='entry' AND revision<>?").run(row.revision);
  expect(maintenanceReferences(site)).toEqual(new Set(['/media/b.txt']));
  const folder=join(site.root,'archives','history','fixture');mkdirSync(folder,{recursive:true});const file=join(folder,'revisions.jsonl');
  writeFileSync(file,JSON.stringify({data:'Historical /media/c.txt'})+'\n');expect(maintenanceReferences(site)).toEqual(new Set(['/media/b.txt','/media/c.txt']));
  writeFileSync(file,JSON.stringify({data:'Historical /media/c.txt and /media/d.txt'})+'\n');expect(maintenanceReferences(site)).toEqual(new Set(['/media/b.txt','/media/c.txt','/media/d.txt']));
});
it('bounds reusable WXR workspaces and leaves derived cache files out of backups',async()=>{
  const site=fixture(),one=new EntryWorkspace(site.root),two=new EntryWorkspace(site.root);
  try{expect(()=>new EntryWorkspace(site.root)).toThrow(/两份/);one.record('test',{id:'one',body:'Data'},['body']);}finally{one.close();two.close();}
  const again=new EntryWorkspace(site.root);again.close();expect(readdirSync(join(site.root,'cache','wxr'))).toHaveLength(2);
  const backup=await createBackup(site,join(base,'backups'));expect(verifyBackup(backup.path).files.every((file:any)=>!file.path.startsWith('cache/'))).toBe(true);
});

it('reuses transient workers without writing durable jobs/logs and keeps the caller responsive',async()=>{
  const site=fixture();for(let index=0;index<40;index++)site.saveEntry(entry('item-'+index,'A paragraph\n\n'.repeat(100)),null);site.publish();
  const runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});runners.push(runner);
  const reports=new TaskResults(runner,0);let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{
    await runner.query('publication-review',{ids:['item-0']});
    expect(ticks).toBeGreaterThan(0);
    await reports.read('analytics-realtime',{query:''});await reports.read('analytics-realtime',{query:''});
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({n:0});
    expect(readdirSync(join(site.root,'logs'))).toEqual([]);
  }finally{clearInterval(timer);runner.stop();}
},20000);

it('queues scheduled work without rendering in the caller and publishes the pinned revision in a real worker',async()=>{
  const site=fixture(),row=site.saveEntry(entry('scheduled'),null),clock=Date.now()-5000;
  const schedule=schedulePublication(site,row.id,row.revision,new Date(clock+1000).toISOString(),clock);
  site.saveEntry({...row.value,title:'Later draft'},row.revision);
  const runner=new JobRunner(site,{startPaused:false,framework:resolve('.'),source:true});runners.push(runner);
  queueScheduledPublications(site,runner);
  const job=site.activeJobs()[0];expect(job.payload.scheduleId).toBe(schedule.id);
  await runner.wait(job.id,15000);
  expect(site.release()!.entries[0].title).toBe('scheduled');expect(site.store.get('entry',row.id)!.value.title).toBe('Later draft');
  expect(site.store.get('publication-schedule',schedule.id)!.value.status).toBe('complete');
},20000);

it('serves immutable program assets with variant-aware validators and HEAD metadata',async()=>{
  const site=fixture(),file=join(site.root,'media','program-hash.js');writeFileSync(file,'const value=42;'.repeat(500));
  const request=(headers:Record<string,string>={},method='GET')=>new Request('http://localhost/_admin/assets/program-hash.js',{headers,method});
  const first=await assetResponse(file,request({'Accept-Encoding':'gzip'}),'text/javascript');
  expect(first.headers.get('Cache-Control')).toContain('immutable');expect(first.headers.get('Content-Encoding')).toBe('gzip');
  const gzipEtag=first.headers.get('ETag')!;expect((await first.arrayBuffer()).byteLength).toBe(Number(first.headers.get('Content-Length')));
  const unchanged=await assetResponse(file,request({'Accept-Encoding':'gzip','If-None-Match':gzipEtag}),'text/javascript');expect(unchanged.status).toBe(304);
  const plain=await assetResponse(file,request({'Accept-Encoding':'gzip;q=0','If-None-Match':gzipEtag}),'text/javascript');expect(plain.status).toBe(200);expect(plain.headers.get('Content-Encoding')).toBeNull();
  const head=await assetResponse(file,request({'Accept-Encoding':'gzip'},'HEAD'),'text/javascript');expect(head.headers.get('ETag')).toBe(gzipEtag);expect(await head.text()).toBe('');
});

it('honors media validators, conditional precedence and If-Range without losing range/HEAD support',async()=>{
  const site=fixture(),file=join(site.root,'media','range.txt');writeFileSync(file,'0123456789');
  const headers={'Content-Type':'text/plain','Accept-Ranges':'bytes','Cache-Control':'public,max-age=0,must-revalidate'};
  const request=(values:Record<string,string>={},method='GET')=>new Request('http://localhost/media/range.txt',{headers:values,method});
  const first=await mediaResponse(file,request(),headers),etag=first.headers.get('ETag')!;
  expect(await first.text()).toBe('0123456789');
  expect((await mediaResponse(file,request({'If-None-Match':'W/'+etag}),headers)).status).toBe(304);
  expect((await mediaResponse(file,request({'If-None-Match':'"other"','If-Modified-Since':new Date(Date.now()+60000).toUTCString()}),headers)).status).toBe(200);
  const part=await mediaResponse(file,request({'Range':'bytes=2-4','If-Range':etag}),headers);expect(part.status).toBe(206);expect(await part.text()).toBe('234');
  const changed=await mediaResponse(file,request({'Range':'bytes=2-4','If-Range':'"old"'}),headers);expect(changed.status).toBe(200);expect(await changed.text()).toBe('0123456789');
  const head=await mediaResponse(file,request({'Range':'bytes=2-4'},'HEAD'),headers);expect(head.headers.get('Content-Length')).toBe('10');expect(await head.text()).toBe('');
});
