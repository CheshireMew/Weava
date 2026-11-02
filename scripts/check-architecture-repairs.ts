import type { Page, BrowserContext } from 'playwright';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entrySchema } from '@weava/contracts';
import sharp from 'sharp';
import { Analytics } from '@weava/core';
import Database from 'better-sqlite3';

export async function checkArchitectureRepairs({page,context,api,origin,root,output}:{page:Page;context:BrowserContext;api:(path:string,value?:any)=>Promise<any>;origin:string;root:string;output:string}) {
  const evidence:Record<string,any>={};
  const until=async(check:()=>Promise<boolean>,label:string)=>{for(let n=0;n<100;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(label);};
  const task=async(job:any)=>{while(['queued','running'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,100));job=await api('job/'+job.id);}assert.equal(job.status,'complete',job.message);return job.result;};
  const nav=async(name:string,wait=true)=>{await page.getByRole('navigation',{name:'网站管理'}).getByRole('button',{name,exact:true}).click();if(wait)await page.getByRole('heading',{name,exact:true}).waitFor();};
  const save=async(id:string,patch:any={})=>api('entry',{value:entrySchema.parse({id,kind:'content',title:id,path:'/'+id+'/',...patch}),revision:null});
  writeFileSync(join(root,'media','architecture-secret.png'),'ARCHITECTURE-PRIVATE-MARKER');
  await save('architecture-private',{visibility:'private',cover:'/media/architecture-secret.png'});
  await save('architecture-alpha',{title:'Architecture Alpha',document:{version:1,format:'markdown',source:'OLD-REFERENCE-MARKER'},blocks:[{id:'body',type:'richtext',props:{text:'NEW-REFERENCE-MARKER'}}]});
  await save('architecture-beta',{title:'Architecture Beta'});
  await save('architecture-html',{kind:'page',blocks:[{id:'compat',type:'compatibility',props:{html:'<p>Preserved HTML</p><script>document.body.dataset.archScript="executed"</script>'}}]});
  await save('architecture-list',{kind:'page',blocks:[{id:'list',type:'content-list',props:{}}]});
  const before=(await page.request.get(origin+'/__health').then(response=>response.json())).releaseId;
  await task(await api('publish',{ids:['architecture-private','architecture-alpha','architecture-beta','architecture-html','architecture-list']}));
  const after=(await page.request.get(origin+'/__health').then(response=>response.json())).releaseId;
  const anonymous=await context.browser()!.newContext(),visitor=await anonymous.newPage();
  try{
    for(const path of ['/media/architecture-secret.png','/media/ARCHITECTURE-SECRET.PNG','/media/foo%2f..%2farchitecture-secret.png'])assert.equal((await anonymous.request.get(origin+path)).status(),404,path);
    evidence['ARC-01']={anonymousCanonicalAndAliasDenied:true};
    await visitor.goto(origin+'/architecture-html/');assert.equal(await visitor.evaluate(()=>document.body.dataset.archScript),undefined);
    const rejected=await context.request.post(origin+'/api/admin/v1/entry',{data:{value:entrySchema.parse({id:'script-url',kind:'page',title:'bad',path:'/bad/',blocks:[{id:'button',type:'button',props:{label:'bad',url:'javascript:alert(1)'}}]}),revision:null}});assert.equal(rejected.status(),400);
    evidence['ARC-02']={htmlPreservedScriptRemoved:true,scriptUrlRejected:true};
    for(const path of ['/search/?page=NaN','/architecture-list/?page=-1','/architecture-list/?page=NaN'])assert.equal((await anonymous.request.get(origin+path)).status(),400,path);
    evidence['ARC-12']={invalidPublicQueries:400};
  }finally{await visitor.close();await anonymous.close();}
  assert.equal((await api('rollback',{id:before})).releaseId,before);assert.equal((await page.request.get(origin+'/__health').then(response=>response.json())).releaseId,before);await api('rollback',{id:after});evidence['ARC-03']={httpAndCommittedPointerAgree:true};
  for(const id of ['architecture%percent','architecture/slash','architecture%2Fliteral']){await save(id,{path:'/encoded-'+Buffer.from(id).toString('hex')+'/'});assert.equal((await api('entry/'+encodeURIComponent(id))).id,id);}
  evidence['ARC-11']={percentSlashAndLiteralEncodedIdsReadable:true};
  await page.goto(origin+'/admin/');await page.getByRole('heading',{name:'内容',exact:true}).waitFor();await nav('外观与导航');
  const settings=await api('settings'),oldName=settings.value.name;
  const remote=await api('settings',{value:{...settings.value,name:'Architecture remote name'},revision:settings.revision});
  await nav('外观与导航');await until(async()=>await page.getByLabel('名称',{exact:true}).inputValue()==='Architecture remote name','clean settings refresh did not adopt value and revision');
  await page.getByLabel('名称',{exact:true}).fill('Architecture local conflict');
  await api('settings',{value:{...remote.value,name:'Architecture newer remote'},revision:remote.revision});
  await nav('内容',false);const failed=page.getByRole('dialog',{name:'修改尚未保存',exact:true});await failed.waitFor();
  assert.equal((await api('settings')).value.name,'Architecture newer remote');
  await failed.getByRole('button',{name:'放弃修改并继续',exact:true}).click();await page.getByRole('heading',{name:'内容',exact:true}).waitFor();
  await nav('外观与导航');await page.getByLabel('名称',{exact:true}).fill('Architecture navigation saved');await nav('内容');
  assert.equal((await api('settings')).value.name,'Architecture navigation saved');evidence['ARC-04']={cleanRefreshAtomic:true,dirtyRefreshConflictRetained:true};
  // An old read may finish after a newer selection. It must not touch the editor.
  await page.getByLabel('搜索内容',{exact:true}).fill('Architecture');await until(async()=>await page.getByRole('button',{name:/Architecture Alpha/}).count()>0,'architecture articles absent');
  let releaseAlpha!:()=>void,startedAlpha!:()=>void;const alphaGate=new Promise<void>(resolve=>releaseAlpha=resolve),alphaStarted=new Promise<void>(resolve=>startedAlpha=resolve);
  await page.route('**/api/admin/v1/entry/architecture-alpha',async route=>{startedAlpha();await alphaGate;await route.continue();});
  await page.getByRole('button',{name:/Architecture Alpha/}).click();await alphaStarted;await page.getByRole('button',{name:/Architecture Beta/}).click();await page.getByLabel('内容标题').waitFor();
  await page.getByLabel('内容标题').fill('Architecture beta latest input');releaseAlpha();await page.waitForTimeout(250);
  assert.equal(await page.getByLabel('内容标题').inputValue(),'Architecture beta latest input');await until(async()=>(await api('entry/architecture-beta')).value.title==='Architecture beta latest input','beta draft not saved');
  await page.unroute('**/api/admin/v1/entry/architecture-alpha');evidence['ARC-05']={lateSelectionIgnored:true,currentInputSaved:true};
  const term=await api('terms',{value:{id:'architecture-term',kind:'category',label:'Architecture Term',slug:'architecture-term'},revision:null});await nav('分类与标签');await page.getByRole('button',{name:'Architecture Term',exact:true}).click();
  let releaseTerm!:()=>void;const termGate=new Promise<void>(resolve=>releaseTerm=resolve);let firstTerm=true;
  await page.route('**/api/admin/v1/terms',async route=>{if(route.request().method()!=='POST'||!firstTerm)return route.continue();firstTerm=false;const response=await route.fetch();await termGate;await route.fulfill({response});});
  await page.getByLabel('分类或标签名称').fill('Architecture first term');await page.getByRole('button',{name:'保存分类或标签',exact:true}).click();await page.getByLabel('分类或标签名称').fill('Architecture latest term');releaseTerm();
  await until(async()=>(await api('terms')).find((row:any)=>row.id===term.id)?.value.label==='Architecture latest term','inflight taxonomy input lost');assert.equal(await page.getByLabel('分类或标签名称').inputValue(),'Architecture latest term');await page.unroute('**/api/admin/v1/terms');
  const image=await sharp({create:{width:32,height:32,channels:3,background:'#315c4b'}}).png().toBuffer();const media=await task(await api('media',{name:'Architecture Media.png',base64:image.toString('base64')}));
  await nav('媒体');await page.getByRole('button',{name:'Architecture Media.png',exact:true}).click();await page.getByLabel('图片说明',{exact:true}).fill('Architecture media alt');await nav('内容');assert.equal((await api('media')).find((row:any)=>row.id===media.id).value.alt,'Architecture media alt');
  const postType=(await api('types')).find((row:any)=>row.id==='post');await nav('内容类型');await page.locator('.object-list button').filter({has:page.getByText('post',{exact:true})}).click();await until(async()=>await page.getByLabel('名称',{exact:true}).inputValue()===postType.value.label,'post type selection not ready');await page.getByLabel('名称',{exact:true}).fill('Architecture post type');await nav('内容');assert.equal((await api('types')).find((row:any)=>row.id==='post').value.label,'Architecture post type');
  await nav('网址别名');await page.getByLabel('来源路径').fill('/architecture-alias/');await page.getByLabel('目标路径').fill('/posts/0/');await nav('内容');assert((await api('redirects')).some((row:any)=>row.id==='/architecture-alias/'));
  const plan=await api('plans',{value:{id:'architecture-plan',name:'Architecture Plan',actions:[{id:'architecture-alpha',revision:(await api('entry/architecture-alpha')).revision,action:'publish'}]},revision:null});
  await nav('发布计划');await page.getByRole('button',{name:/Architecture Plan/}).click();await page.getByLabel('计划名称').fill('Architecture plan navigation');await nav('内容');assert.equal((await api('plans')).find((row:any)=>row.id===plan.id).value.name,'Architecture plan navigation');
  await api('layouts',{value:{id:'architecture-layout',kind:'template',label:'Architecture Layout',appliesTo:'any',blocks:[{id:'body',type:'entry-body',props:{}}]},revision:null});
  await nav('布局');await page.getByRole('button',{name:'Architecture Layout',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('Architecture layout navigation');await nav('内容');assert.equal((await api('layouts')).find((row:any)=>row.id==='architecture-layout').value.label,'Architecture layout navigation');
  await nav('外观与导航');await page.getByLabel('名称',{exact:true}).fill('Architecture recovered settings');
  await page.reload();await page.getByRole('heading',{name:'内容',exact:true}).waitFor();await nav('外观与导航');await page.getByRole('button',{name:'恢复本地修改',exact:true}).click();assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'Architecture recovered settings');await nav('内容');assert.equal((await api('settings')).value.name,'Architecture recovered settings');
  evidence['ARC-06']={inflightTaxonomyEditsSaved:true};evidence['ARC-08']={allSevenPanelNavigationSaved:true,explicitDiscardAfterConflict:true,localRecoveryAfterReload:true};
  const summary=await api('state?summary=1&panel=content');assert.deepEqual(summary.media,[]);assert.deepEqual(summary.jobs,[]);assert.deepEqual(summary.releases,[]);evidence['ARC-18']={contentBootstrapOmitsUnrelatedCollections:true};
  // Build scale data in the test process. The report itself must run through real HTTP and a compiled worker.
  const analytics=new Analytics(root),insert=analytics.raw.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)'),stamp=new Date().toISOString();
  try{analytics.raw.transaction(()=>{for(let index=0;index<100000;index++)insert.run('architecture-event-'+index,'view',stamp,'/architecture-alpha/','reader-'+index%10000,'session-'+index%10000,'','','','','');})();}finally{analytics.close();}
  const began=Date.now();let finished=false,report:any,reportError:unknown;const healthMs:number[]=[];
  const reporting=context.request.get(origin+'/api/admin/v1/analytics',{timeout:140000}).then(async response=>{assert(response.ok(),await response.text());report=await response.json();}).catch(error=>{reportError=error;}).finally(()=>{finished=true;});
  while(!finished){const tick=Date.now();assert.equal((await context.request.get(origin+'/__health')).status(),200);healthMs.push(Date.now()-tick);await new Promise(resolve=>setTimeout(resolve,100));}
  await reporting;if(reportError)throw reportError;assert(report.views>=100000);assert(healthMs.length>1);assert(Math.max(...healthMs)<1500);
  evidence['ARC-07']={events:100000,reportMs:Date.now()-began,healthSamples:healthMs.length,healthMaxMs:Math.max(...healthMs),views:report.views};
  const db=new Database(join(root,'weava.sqlite'));
  try{
    const buckets=()=>new Set((db.prepare("SELECT id FROM engagement_limits WHERE id LIKE 'likes:%'").all() as {id:string}[]).map(row=>row.id));const previous=buckets();
    for(const ip of ['192.0.2.101','192.0.2.102'])assert.equal((await context.request.post(origin+'/api/v1/like',{headers:{'x-forwarded-for':ip,origin},data:{id:'architecture-alpha',liked:true}})).status(),200);
    assert.equal([...buckets()].filter(id=>!previous.has(id)).length,2);
    const cookie=await fetch(origin+'/api/v1/engagement?id=architecture-alpha',{headers:{'x-forwarded-for':'192.0.2.103','x-forwarded-proto':'https'}});assert.match(cookie.headers.get('set-cookie')??'',/;\s*Secure/i);
    evidence['ARC-22']={forwardedReadersUseDistinctLimits:true,forwardedHttpsCookieSecure:true};
  }finally{db.close();}
  await page.screenshot({path:join(output,'architecture-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'architecture-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  const latest=await api('settings');await api('settings',{value:{...latest.value,name:oldName},revision:latest.revision});
  writeFileSync(join(output,'architecture-results.json'),JSON.stringify(evidence,null,2));return evidence;
}
