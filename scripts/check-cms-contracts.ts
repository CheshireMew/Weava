import { strict as assert } from 'node:assert';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { createAdminClient } from '@weava/contracts/api-client';
import { adminApi } from '@weava/contracts/api';

export async function checkCmsContracts({origin,root,output,page,api,cli}:{origin:string;root:string;output:string;page:Page;api:(action:string,value?:any)=>Promise<any>;cli:(args:string[])=>Promise<any>}) {
  const client=createAdminClient({baseUrl:origin+'/api/admin/v1/',headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8')}});
  const wait=async(job:any)=>{for(let i=0;i<200&&['queued','running'].includes(job.status);i++){await new Promise((resolve)=>setTimeout(resolve,100));job=await client.call('job',{params:{id:job.id}});}assert.equal(job.status,'complete',job.message);return job;};
  const publish=async(ids:string[])=>{const review=await client.call('publication',{body:{ids}});await wait(await client.call('publish',{body:review.options}));};
  const open=async(title:string)=>{await page.goto(origin+'/admin/');await page.getByLabel('搜索内容').fill(title);await page.locator('.entry-list button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();};
  const settings=await client('settings');const before=await client('state?summary=1');
  assert.equal(before.settings.revision,settings.revision);
  const openapi=await api('schema?format=openapi');
  let documented=0;for(const definition of Object.values(adminApi)){const operation=openapi.paths['/api/admin/v1/'+definition.path]?.[definition.method.toLowerCase()];assert(operation?.responses?.[definition.status]?.content);documented++;}
  assert.equal(documented,95);
  const invalid=await fetch(origin+'/api/admin/v1/comment',{method:'POST',headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8'),'Content-Type':'application/json'},body:JSON.stringify({id:'not-a-comment',status:'pending'})});assert.equal(invalid.status,400);
  assert.equal((await client('state?summary=1')).settings.revision,settings.revision);
  const analytics=await client.call('analytics',{});assert.equal(typeof analytics.views,'number');await client.call('realtime',{});await client.call('visitor',{query:{id:'contract-empty-visitor'}});await client.call('geo',{});await client.call('seoAudits',{});await client.call('searchData',{});
  const csv=await client.call('exportAnalytics',{});assert.equal(typeof csv,'string');
  const typesFile=join(output,'generated-client.ts');await cli(['schema','--format','types','--output',typesFile]);assert(readFileSync(typesFile,'utf8').includes('createAdminClient'));
  // Empty related results must be filled with the latest eligible article.
  const current=await client.call('saveEntry',{body:{revision:null,value:{id:'contract-current',kind:'content',type:'post',title:'无匹配文章',path:'/contract-current/',publishedAt:'2026-01-01T00:00:00Z'}}});
  const latest=await client.call('saveEntry',{body:{revision:null,value:{id:'contract-latest',kind:'content',type:'post',title:'回退最新文章',path:'/contract-latest/',publishedAt:'2090-01-01T00:00:00Z'}}});
  const privateEntry=await client.call('saveEntry',{body:{revision:null,value:{id:'contract-private',kind:'content',type:'post',title:'不应出现的私密推荐',path:'/contract-private/',visibility:'private',publishedAt:'2091-01-01T00:00:00Z'}}});
  const excluded=await client.call('saveEntry',{body:{revision:null,value:{id:'contract-excluded',kind:'content',type:'post',title:'不应出现的不收录推荐',path:'/contract-excluded/',indexable:false,publishedAt:'2092-01-01T00:00:00Z'}}});
  await publish([current.id,latest.id,privateEntry.id,excluded.id]);await page.goto(origin+current.value.path);
  const related=page.locator('.related-content, [data-recommend-list="related"]');await related.getByRole('link',{name:latest.value.title,exact:true}).waitFor();
  assert.equal(await related.getByRole('link').first().getAttribute('href'),latest.value.path);assert(!(await related.innerText()).includes(privateEntry.value.title));assert(!(await related.innerText()).includes(excluded.value.title));
  await page.screenshot({path:join(output,'contract-latest-fallback.png'),fullPage:true});
  // A selected card becomes a reusable independent fragment rather than copying
  // every block in the article. The type policy applies to the picker and save.
  await client.call('saveType',{body:{revision:null,value:{id:'contract-card',label:'限定区块文章',fields:[],pathPrefix:'/cards/',template:'article',allowedBlocks:['text','richtext']}}});
  const entry=await client.call('saveEntry',{body:{revision:null,value:{id:'contract-card',kind:'content',type:'contract-card',title:'区块限制与片段验收',path:'/contract-card/',blocks:[{id:'first',type:'text',props:{text:'第一段正文'}},{id:'fragment',type:'text',props:{text:'独立作者介绍'}}]}}});
  await open(entry.value.title);await page.getByLabel('区块类型').locator('option[value="text"]').waitFor({state:'attached'});const choices=await page.getByLabel('区块类型').locator('option').evaluateAll((nodes)=>nodes.map((node)=>(node as HTMLOptionElement).value));assert.deepEqual(choices.sort(),['richtext','text']);
  await page.locator('.block-outline > li').nth(1).getByRole('button').click();page.once('dialog',(dialog)=>dialog.accept('所选作者介绍'));
  await page.getByRole('button',{name:'保存所选片段',exact:true}).click();await page.getByText('所选片段已保存为组合',{exact:true}).waitFor();
  const fragment=(await client('layouts')).find((row)=>row.value.label==='所选作者介绍');assert(fragment);assert.equal(fragment.value.blocks.length,1);assert.equal(fragment.value.blocks[0].props.text,'独立作者介绍');
  await page.getByLabel('插入组合').selectOption(fragment.id);let saved;
  for(let i=0;i<100;i++){saved=await client.call('getEntry',{params:{id:entry.id}});if(saved.value.blocks.length===3)break;await new Promise((resolve)=>setTimeout(resolve,100));}
  assert(saved&&saved.value.blocks.length===3);assert.notEqual(saved.value.blocks[2].id,fragment.value.blocks[0].id);
  const layoutRevision=fragment.revision;await client('layouts',{value:{...fragment.value,blocks:[{...fragment.value.blocks[0],props:{text:'模板之后修改的介绍'}}]},revision:layoutRevision});
  assert.equal((await client.call('getEntry',{params:{id:entry.id}})).value.blocks[2].props.text,'独立作者介绍');
  const denied=await fetch(origin+'/api/admin/v1/entry',{method:'POST',headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8'),'Content-Type':'application/json'},body:JSON.stringify({value:{...saved.value,blocks:[{id:'not-allowed',type:'code',props:{source:'x'}}]},revision:saved.revision})});assert.equal(denied.status,400);assert.equal((await client.call('getEntry',{params:{id:entry.id}})).revision,saved.revision);
  await page.getByRole('button',{name:'内容类型',exact:true}).click();await page.locator('.object-list').getByRole('button',{name:/限定区块文章/}).click();await page.getByText('正文区块',{exact:true}).click();assert.equal(await page.getByLabel('限制可用区块',{exact:true}).isChecked(),true);
  await page.getByLabel('允许区块 代码',{exact:true}).check();await page.getByRole('button',{name:'保存类型',exact:true}).click();
  await page.getByText('内容类型已保存',{exact:true}).waitFor();assert((await client('types')).find((row)=>row.id==='contract-card')!.value.allowedBlocks?.includes('code'));
  await open(entry.value.title);await page.getByLabel('区块类型').selectOption('code');
  await page.frameLocator('iframe[title="页面画布"]').getByText('第一段正文',{exact:true}).waitFor();
  await page.locator('.block-outline > li').nth(1).getByRole('button').click();await page.getByRole('button',{name:'保存所选片段',exact:true}).waitFor();
  await page.screenshot({path:join(output,'contract-selected-snippet.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开菜单',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,'contract-selected-snippet-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  const result={all95OperationsDocumented:true,typedBrowserAndCliClient:true,runtimeRequestAndResponseChecks:true,analyticsAndTextResponses:true,latestRecommendationFallback:true,privateAndExcludedOmitted:true,selectedFragmentOnly:true,insertedFragmentIndependent:true,typeBlockPolicyEditor:true,typeBlockPolicyServer:true};
  writeFileSync(join(output,'cms-contracts-results.json'),JSON.stringify(result,null,2));return result;
}
