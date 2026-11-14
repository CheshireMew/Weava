import {afterEach,it,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {Site} from '../packages/core/src/site.ts';
import {JobRunner} from '../packages/core/src/job-runner.ts';
import {entrySchema} from '../packages/contracts/src/index.ts';
import {jobSchema,mergePreview} from '../packages/contracts/src/api-models.ts';
import {BusinessStore,websiteContext} from '../packages/core/src/site-sdk.ts';
import {readonlyView} from '../packages/core/src/readonly-view.ts';
import {queryDrafts} from '../packages/core/src/query.ts';
import {createBackup,restoreBackup} from '../packages/core/src/backup.ts';
import {beginMediaUpload,receiveMediaChunk,mediaUploadStatus} from '../packages/core/src/media-upload.ts';
import {repairSiteBuildLink} from '../packages/core/src/build-links.ts';
import {siteRoutes} from '../packages/core/src/site-routes.ts';
import {loadSiteRenderer} from '../packages/core/src/site-render.ts';
import {mergeEntry,saveMergedEntry} from '../packages/core/src/revisions.ts';
import {previewRedirects} from '../packages/core/src/redirects.ts';
import {publicInventory} from '../packages/manager/src/public-inventory.ts';
import {applyFeatures,checkFeatures,selection} from '../packages/manager/src/operations.ts';
import {atomic,loadInstallation,updateInstallation,descriptor} from '../packages/manager/src/state.ts';
import {requestHost} from '../packages/manager/src/host.ts';
import {legacyStorage} from './fixtures/legacy-storage.ts';
import {fixtureBuild,fixtureProgram} from './fixtures/managed-program.ts';
import {queueJsonImport} from '../packages/core/src/json-import.ts';
import {previewTemporaryCleanup} from '../packages/core/src/temporary-files.ts';

const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/architecture-repair-20261106';
const sites:Site[]=[];
function fixture(){const site=new Site(join(base,'case-'+randomUUID()));sites.push(site);return site;}
const page=(id='page')=>entrySchema.parse({id,kind:'page',title:'Original',path:'/'+id+'/',document:{version:1,format:'markdown',source:'Original body'}});
afterEach(()=>sites.splice(0).forEach(site=>site.close()));

it('ARC-R04 starts persistent task execution only after an explicit readiness transition',async()=>{
 const site=fixture(),runner=new JobRunner(site,{framework:resolve('.'),source:true});
 try{const job=runner.enqueue('unknown-fixture',{});await new Promise(r=>setTimeout(r,350));runner.pump();expect(site.job(job.id).status).toBe('queued');runner.pause(false);runner.pump();expect(site.job(job.id).status).toBe('running');await expect(runner.wait(job.id,15000)).rejects.toThrow('未知任务');}
 finally{runner.stop();}
},20000);

it('ARC-R07 exposes deeply readonly SDK content, query results and settings without eagerly reading lazy bodies',()=>{
 const site=fixture();site.saveEntry(page(),null);site.publish({ids:['page']});const business=new BusinessStore(site.root,'migrate');
 try{
  const context=websiteContext(site,business,{enqueue(){}},new Request('http://localhost/'));
  expect(()=>context.content.get('page').title='Changed').toThrow();expect(()=>context.content.get('page').document.source='Changed').toThrow();
  expect(()=>context.settings.navigation.push({label:'bad',url:'/bad/'})).toThrow();
  expect(()=>context.content.query({kind:'page'}).items.splice(0)).toThrow();
  expect(site.visibleRelease()!.entries[0].title).toBe('Original');expect(site.store.get('entry','page')!.value.document.source).toBe('Original body');
  let reads=0;const value={get document(){reads++;return {source:'lazy'};}};const view=readonlyView(value);expect(reads).toBe(0);expect(()=>{(view as any).document.source='changed';}).toThrow();expect(reads).toBe(1);
 }finally{business.close();}
});

it('ARC-R09 retains worker failure details in the wire contract',()=>{
 expect(jobSchema.parse({id:'job',operation:'publish',status:'failed',createdAt:'now',updatedAt:'now',message:'conflict',errorStatus:409,errorDetails:{revision:3}})).toMatchObject({errorStatus:409,errorDetails:{revision:3}});
});

it('ARC-R08 migrates existing list covers without changing authored revisions or reading bodies during listing',()=>{
 const site=fixture(),row=site.saveEntry({...page(),document:{version:1,format:'markdown',source:'![Cover](https://example.com/cover.png)'}},null);
 const count=site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get();
 site.store.raw.prepare("UPDATE entry_list SET summary=json_remove(summary,'$.cover') WHERE id=?").run(row.id);
 legacyStorage(site.store.raw,13);site.close();
 expect(()=>new Site(site.root,{mode:'open'})).toThrow(/需要迁移/);
 const migrated=new Site(site.root,{mode:'migrate'});sites.push(migrated);
 expect(migrated.store.get('entry',row.id)!.revision).toBe(row.revision);expect(migrated.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get()).toEqual(count);
 const get=migrated.store.get.bind(migrated.store);migrated.store.get=((scope:string,id:string)=>{if(scope==='entry')throw new Error('full body read');return get(scope,id);}) as typeof migrated.store.get;
 expect(queryDrafts(migrated,{kind:'page'}).items[0].value.cover).toBe('https://example.com/cover.png');
});

it('ARC-R05/12/13 rebuilds active dependency references on restore and shares deployment routing rules',async()=>{
 const site=fixture(),home=join(site.root,'installation'),program=fixtureProgram(home);fixtureBuild(site.root,home,program);repairSiteBuildLink(site.root,'one',program.root);
 const business=new BusinessStore(site.root,'migrate');business.close();
 const routes=siteRoutes(site.root);expect(routes.matches('/products/42/')).toBe(true);expect(routes.matches('/not-declared/')).toBe(false);
 const row=site.saveEntry({...page(),document:{version:1,format:'markdown',source:'[Tool](/tools/) and [Product](/products/42/)'}},null);expect(()=>site.publish({ids:[row.id]})).not.toThrow();
 expect(()=>previewRedirects(site,{items:[{source:'/old-tool/',target:'/tools/',revision:null}]})).not.toThrow();
 atomic(join(site.root,'site.json'),{version:2,id:'fixture',port:4500,features:['content','media'],template:'blank'});
 expect(publicInventory(site.root).paths).toContain('/tools/');
 const backup=await createBackup(site,join(base,'backups')),target=join(base,'restored-'+randomUUID());
 await restoreBackup(backup.path,target,join(base,'before-restores'));
 expect(realpathSync.native(join(target,'site-builds/one/node_modules')).toLowerCase()).toBe(realpathSync.native(join(program.root,'node_modules')).toLowerCase());
 const restored=new Site(target),data=new BusinessStore(target);try{
  const renderer=(await loadSiteRenderer(target))!,request=new Request('http://localhost/tools/');
  expect(await (await renderer.render(request,websiteContext(restored,data,{enqueue(){}},request,true)))!.text()).toContain('Shared dependency');
  const stable=await renderer.render(new Request('http://localhost/logo.svg'),{} as any),versioned=await renderer.render(new Request('http://localhost/_site/one/logo.svg'),{} as any);
  expect(stable!.headers.get('cache-control')).toBe('public, no-cache');expect(versioned!.headers.get('cache-control')).toContain('immutable');
  expect(await renderer.render(new Request('http://localhost/not-declared/'),{} as any)).toBeNull();
 }finally{data.close();restored.close();}
});

it('ARC-R18 invalidates copied upload offsets and unfinished media jobs without changing the live upload',async()=>{
 const site=fixture(),upload=beginMediaUpload(site,'pending.txt',4,undefined,'a'.repeat(64));
 await receiveMediaChunk(site,upload.id,0,new Request('http://localhost/',{method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.from('ab')}));
 const processing=beginMediaUpload(site,'processing.txt',2,undefined,'b'.repeat(64)),job=site.createJob('media',{uploadId:processing.id});
 site.updateJob(job.id,{status:'running',workerPid:123});site.store.raw.prepare("UPDATE media_uploads SET status='processing',offset=2,job_id=? WHERE id=?").run(job.id,processing.id);
 const runner=new JobRunner(site,{framework:resolve('.'),source:true});
 let imported:any;try{imported=await queueJsonImport(site,runner,new Request('http://localhost',{method:'POST',body:'{"value":{"version":1}}'}));}finally{runner.stop();}
 const backup=await createBackup(site,join(base,'backups')),target=join(base,'upload-restored-'+randomUUID());await restoreBackup(backup.path,target,join(base,'before-restores'));
 const restored=new Site(target);try{expect(mediaUploadStatus(restored,upload.id)).toMatchObject({offset:0,status:'expired'});expect(Date.parse(mediaUploadStatus(restored,upload.id).expiresAt)).toBe(0);expect(mediaUploadStatus(restored,processing.id).status).toBe('expired');expect(restored.job(job.id)).toMatchObject({status:'failed',errorStatus:409});expect(site.job(job.id).status).toBe('running');expect(mediaUploadStatus(site,upload.id).offset).toBe(2);expect(existsSync(join(site.root,'uploads',upload.id+'.bin'))).toBe(true);
 expect(restored.job(imported.id)).toMatchObject({status:'failed',errorStatus:409});expect(site.job(imported.id).status).toBe('queued');expect(previewTemporaryCleanup(restored).files.some(file=>file.kind==='request')).toBe(true);
 }finally{restored.close();}
});

it('ARC-R02/03 requires explicit conflict choices when another window saved a local-only note first',()=>{
 const site=fixture(),local=page(),remote=site.saveEntry({...local,title:'Other window',document:{version:1,format:'markdown',source:'Other body'}},null);
 const plan=mergePreview.parse(mergeEntry(site,local.id,0,local));expect(plan.base.revision).toBe(0);expect(plan.conflicts.map(item=>item.path)).toContain('/document');
 expect(()=>saveMergedEntry(site,{id:local.id,baseRevision:0,currentRevision:remote.revision,value:local})).toThrow(/每处/);
 const choices=Object.fromEntries(plan.conflicts.map(item=>[item.path,'local' as const]));expect(saveMergedEntry(site,{id:local.id,baseRevision:0,currentRevision:remote.revision,value:local,choices}).value.document).toEqual(local.document);
});

it('ARC-R14 checks references again while holding the maintenance lease',async()=>{
 const site=fixture(),home=join(site.root,'installation'),program=fixtureProgram(home);atomic(join(site.root,'site.json'),{version:2,id:'fixture',port:4500,features:['media'],template:'blank'});
 expect(checkFeatures(site.root,[])).toEqual([]);
 site.store.put('media','arrived-after-precheck',{name:'Concurrent upload',url:'/media/one.txt',bytes:2,createdAt:'now'},null);site.close();
 await expect(applyFeatures(home,site.root,program,[])).rejects.toThrow(/媒体|引用/);expect(descriptor(site.root).features).toEqual(['media']);
},20000);

async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=(server.address() as any).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return value as number;}
it('ARC-R15 retains activation and the actual launch port after an unexpected managed process exit',async()=>{
 const site=fixture(),home=join(site.root,'host'),configured=await port(),override=await port();site.close();
 const code=`import{createServer}from'node:http';let validating=process.env.WEAVA_VALIDATION==='1';const server=createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({nonce:process.env.WEAVA_RUN_NONCE,pid:process.pid,validating,probe:process.env.WEAVA_UPGRADE_PROBE}));if(q.url==='/crash')setTimeout(()=>process.exit(7),40);});server.listen(Number(process.env.PORT),'127.0.0.1');process.on('message',m=>{if(m.action==='resume'){validating=false;process.send({controlId:m.controlId,value:{resumed:true}});}if(m.action==='drain')process.send({controlId:m.controlId,value:{drained:true}});if(m.action==='shutdown')server.close(()=>process.exit(0));});`;
 const program=fixtureProgram(home,code);atomic(join(site.root,'site.json'),{version:2,id:'fixture',port:configured,features:[],template:'blank'});atomic(join(site.root,'program.json'),selection(home,program));
 updateInstallation(home,value=>{value.sites.fixture={root:site.root,autostart:false};});
 const source=pathToFileURL(resolve('packages/manager/src/host.ts')).href;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import{serveHost}from ${JSON.stringify(source)};await serveHost(${JSON.stringify(home)});`],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',data=>errors+=data);
 try{
  let started=false;for(let n=0;n<100;n++){try{await requestHost(home,'status');started=true;break;}catch{}if(child.exitCode!==null)throw new Error(errors);await new Promise(r=>setTimeout(r,100));}expect(started,errors).toBe(true);
  const first=await requestHost(home,'start',{id:'fixture',port:override,validation:true,probeToken:'test-probe'});
  await requestHost(home,'activate',{id:'fixture'});
  expect(await(await fetch('http://127.0.0.1:'+override+'/__health')).json()).toMatchObject({validating:false});
  await(await fetch('http://127.0.0.1:'+override+'/crash')).body?.cancel();
  let nonce=first.nonce;for(let n=0;n<120&&nonce===first.nonce;n++){await new Promise(r=>setTimeout(r,100));try{nonce=(await(await fetch('http://127.0.0.1:'+override+'/__health',{signal:AbortSignal.timeout(500)})).json() as any).nonce;}catch{}}
  expect(nonce).not.toBe(first.nonce);
  let status=await requestHost(home,'status');for(let n=0;n<30&&status.sites[0].status==='starting';n++){await new Promise(r=>setTimeout(r,100));status=await requestHost(home,'status');}
  expect(status.sites[0].status).toBe('running');
  expect(await(await fetch('http://127.0.0.1:'+override+'/__health')).json()).toMatchObject({validating:false,probe:''});
 }finally{if(child.exitCode===null){await requestHost(home,'shutdown',{timeoutMs:5000}).catch(()=>{});if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill();}}
},30000);
