import {requestApi} from '@weava/contracts/api-transport';
import { expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminApi,matchAdminApi,validateApiInput,type ApiOutput } from '@weava/contracts/api';
import { createAdminClient,ApiClientError } from '@weava/contracts/api-client';
import { authoringOpenApi } from '../packages/contracts/src/api-openapi.ts';
import { apiReferenceMarkdown } from '../packages/contracts/src/api-reference.ts';
import { createAdminHandlers } from '../apps/web/src/api/dispatch.ts';
import { exchangeHandlers } from '../apps/web/src/api/exchange.ts';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type { ApiServices } from '../apps/web/src/api/types.ts';
import {Site,Analytics,Engagement} from '@weava/core';
import {entrySchema} from '@weava/contracts';
import {contentHandlers} from '../apps/web/src/api/content.ts';
it('keeps the reviewed cover, summary and author alongside the frozen publication revision',()=>{
 const review=adminApi.publication.response.parse({scope:'entries',baseReleaseId:null,settingsChanged:false,layoutsChanged:false,routesChanged:false,termsChanged:false,entries:[{id:'article',title:'待发布文章',path:'/article/',cover:'/media/cover.webp',description:'摘要内容',author:'柴郡',visibility:'private',revision:37,action:'add'}],removed:[],options:{candidateId:'review',ids:['article'],revisions:{article:37}}});
 expect(review.entries[0]).toMatchObject({cover:'/media/cover.webp',description:'摘要内容',author:'柴郡',visibility:'private',revision:37});
 expect(review.options).toMatchObject({candidateId:'review',revisions:{article:37}});
});

it('declares every built-in admin route and gives each operation request and response documentation',()=>{
  const handlers=createAdminHandlers({} as ApiServices);
  expect(Object.keys(handlers).sort()).toEqual(Object.keys(adminApi).sort());
  expect(matchAdminApi('GET','entry/encoded%3Aid')?.params.id).toBe('encoded:id');
  expect(matchAdminApi('GET','job/task')).toBeDefined();
  const document=authoringOpenApi('test','https://example.com');
  for(const [name,definition]of Object.entries(adminApi)){
    expect(matchAdminApi(definition.method,definition.path.replace('{id}','encoded%3Aid'))?.operation).toBe(name);
    const operation=document.paths['/api/admin/v1/'+definition.path][definition.method.toLowerCase()] as {operationId:string;parameters:{name:string;in:string;required:boolean}[];responses:Record<string,{content:Record<string,{schema:object}>}>;requestBody?:object};
    expect(operation.operationId).toBe(name);expect(operation.responses[definition.status].content).toBeDefined();expect(operation.responses['409']).toBeDefined();
    if(definition.method==='POST')expect(operation.requestBody).toBeDefined();
    for(const param of definition.path.matchAll(/\{(\w+)\}/g))expect(operation.parameters).toContainEqual(expect.objectContaining({name:param[1],in:'path',required:true}));
  }
  expect(new Set(Object.values(adminApi).map(operation => operation.method + ' ' + operation.path)).size).toBe(Object.keys(adminApi).length);
  expect(readFileSync('docs/api-reference.md','utf8')).toBe(apiReferenceMarkdown());
});
it('checks request revisions and query types with the same rules used by server and client',()=>{
  const write=matchAdminApi('POST','comment')!;
  expect(()=>validateApiInput(write,new URLSearchParams(),{id:'a',status:'pending'})).toThrow();
  expect(()=>validateApiInput(matchAdminApi('GET','comments')!,new URLSearchParams('page=-1'),undefined)).toThrow();
  expect(matchAdminApi('DELETE','entry')).toBeUndefined();
  expect(()=>adminApi.saveSettings.body.parse({value:{},revision:null})).toThrow();
  expect(adminApi.importWxr.body.parse({xml:'<rss/>',options:{mediaDirectory:'D:/imports'}}).options?.mediaDirectory).toBe('D:/imports');
});

it('returns public dates, URLs and real lifetime interactions without saving or publishing working changes',async()=>{
  const site=new Site((process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/content-list-metrics-'+Date.now());
  const analytics=new Analytics(site.root),engagement=new Engagement(site.store.raw,'test-secret');
  try{
    site.saveType({id:'post',label:'Article',fields:[],pathPrefix:'/',template:'article'},null);
    const original=site.saveEntry(entrySchema.parse({id:'article',title:'Published article',kind:'content',type:'post',path:'/published/',status:'published',publishedAt:'2026-07-21T04:00:00Z',document:{version:1,format:'markdown',source:'Body'}}),null);
    site.publish({ids:['article']});
    const draft=site.saveEntry({...original.value,path:'/draft/',publishedAt:'2026-11-06T04:00:00Z'},original.revision);
    site.saveEntry(entrySchema.parse({id:'draft',title:'Draft',kind:'content',type:'post',path:'/new/',document:{version:1,format:'markdown',source:'Draft'}}),null);
    engagement.setLike('article','a'.repeat(64),true); engagement.setLike('other','b'.repeat(64),true);
    const insert=site.store.raw.prepare('INSERT INTO article_comments(id,entry_id,reader_key,network_key,client_id,author,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for(const status of ['visible','hidden','pending'])insert.run(status,'article','reader','network',status,'Reader','Comment',status,'2026-07-21T05:00:00Z');
    analytics.importViewTotals({sourceId:'test-import',capturedAt:'2026-07-21T06:00:00Z',entries:[{entryId:'article',path:'/published/',views:1234}]});
    expect(engagement.countsFor([]).size).toBe(0);
    expect(engagement.countsFor(['article','other','empty']).get('article')).toEqual({likes:1,comments:1});
    expect(engagement.countsFor(['empty']).get('empty')).toEqual({likes:0,comments:0});
    const handlers=contentHandlers({site,analytics,engagement,jobs:{} as any});
    const result=adminApi.queryEntries.response.parse(await handlers.queryEntries({} as any,{url:new URL('http://localhost/api/admin/v1/entries/query?kind=content')} as any));
    const row=result.items.find(item=>item.id==='article')!;
    expect(row.publication).toEqual({path:'/published/',publishedAt:'2026-07-21T04:00:00Z'});
    expect(row.metrics).toEqual({likes:1,comments:1,views:1234});expect(row.hasChanges).toBe(true);
    expect(result.items.find(item=>item.id==='draft')?.metrics).toBeUndefined();
    expect(site.store.get('entry','article')?.revision).toBe(draft.revision);
    expect(site.visibleRelease()?.entries.find(entry=>entry.id==='article')?.path).toBe('/published/');
  }finally{analytics.close();site.close();}
});
it('builds encoded paths and query strings through the operation client',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const client=createAdminClient({baseUrl:'https://example.com/api/admin/v1',fetch:async(url,init)=>{
    calls.push({url:String(url),init});return Response.json({id:'a/b',title:'a',revision:2});
  }});
  const result=await client.call('planEntry',{query:{id:'a/b'}});expect(result.revision).toBe(2);
  expect(calls[0].url).toBe('https://example.com/api/admin/v1/plans/entry?id=a%2Fb');
  const match=matchAdminApi('GET','entry/a%2Fb');expect(match?.params.id).toBe('a/b');
});
it('passes the reviewed local attachment directory through the actual job dispatch boundary',async()=>{
  const root=(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/import-dispatch-'+Date.now();mkdirSync(join(root,'imports'),{recursive:true});
  const enqueue=vi.fn(()=>({id:'queued',status:'queued'}));
  const handlers=exchangeHandlers({site:{root},jobs:{enqueue}} as any);
  await handlers.importWxr({body:adminApi.importWxr.body.parse({xml:'<rss/>',options:{mediaDirectory:'D:/imports',downloadMedia:false}})} as any,{request:new Request('http://localhost/api/admin/v1/import/wxr')} as any);
  expect(enqueue.mock.calls[0]).toEqual(['import-wxr',expect.objectContaining({options:expect.objectContaining({mediaDirectory:'D:/imports',downloadMedia:false})}),undefined]);
});
it('rejects malformed responses and reports login expiration without replaying a write',async()=>{
  let calls=0,expired=0;
  const client=createAdminClient({onUnauthorized:()=>expired++,fetch:async()=>{calls++;return Response.json({error:'请先登录。'},{status:401});}});
  await expect(client('comment',{id:'a',status:'visible'})).rejects.toMatchObject({status:401});expect(calls).toBe(1);expect(expired).toBe(1);
  const invalid=createAdminClient({fetch:async()=>Response.json({authenticated:true})});await expect(invalid('session')).rejects.toBeInstanceOf(ApiClientError);await expect(invalid('session')).rejects.toMatchObject({status:502});
  let sent=false;const guarded=createAdminClient({fetch:async()=>{sent=true;return Response.json({});}});
  await expect(guarded.request('comment',{id:'a',status:'pending'})).rejects.toMatchObject({status:400});expect(sent).toBe(false);
});
it('exports typed operation inputs and results rather than a universal any transport',()=>{
  const client=createAdminClient();type IsAny<T>=0 extends (1&T)?true:false;
  const outputIsAny:IsAny<ApiOutput<'session'>>=false;expect(outputIsAny).toBe(false);
  if(false){
    // @ts-expect-error Unknown endpoints must not compile.
    void client('missing-operation');
    // @ts-expect-error The moderation body is not an arbitrary object.
    void client('comment',{id:'a',status:'pending'});
    // @ts-expect-error Query parameter is required for this operation.
    void client.call('planEntry',{query:{}});
    void client.call('planEntry',{query:{id:'a'}});
    // @ts-expect-error Path parameters cannot be omitted.
    void client.call('getEntry',{});
    void client.call('getEntry',{params:{id:'a'}});
  }
});
it('allows queued analytics and WXR reads to finish, while respecting explicit client budgets',async()=>{
  const budgets:number[]=[],timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{budgets.push(milliseconds);return new AbortController().signal;});
  const transport:typeof fetch=async()=>Response.json({error:'Test response'},{status:400});
  try{
    const client=createAdminClient({fetch:transport});
    for(const path of ['analytics','analytics/realtime','analytics/visitor?id=reader','analytics/export'])await expect(client.request(path)).rejects.toMatchObject({status:400});
    await expect(client.request('import/wxr',{xml:'<rss/>',options:{dryRun:true}})).rejects.toMatchObject({status:400});
    await expect(client.request('session')).rejects.toMatchObject({status:400});
    await expect(createAdminClient({fetch:transport,timeoutMs:5000}).request('analytics')).rejects.toMatchObject({status:400});
    expect(budgets).toEqual([140000,140000,140000,140000,140000,30000,5000]);
  }finally{timeout.mockRestore();}
});

it('shares transport errors and retry metadata while leaving anonymous login failures local',async()=>{
 const expired=vi.fn(),fetch=vi.fn(async()=>Response.json({error:'登录失败',details:{reason:'test'}},{status:401,headers:{'Retry-After':'12'}}));
 const options={fetch,onUnauthorized:expired};
 await expect(requestApi('login',{},adminApi.session.response,options,{anonymous:true})).rejects.toMatchObject({status:401,retryAfter:12,details:{reason:'test'}});
 expect(expired).not.toHaveBeenCalled();
 await expect(requestApi('session',undefined,adminApi.session.response,options)).rejects.toMatchObject({status:401});
 expect(expired).toHaveBeenCalledWith('session');expect(fetch).toHaveBeenCalledTimes(2);
});
