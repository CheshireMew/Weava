import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminApi,matchAdminApi,validateApiInput,type ApiOutput } from '@weava/contracts/api';
import { createAdminClient,ApiClientError } from '@weava/contracts/api-client';
import { authoringOpenApi } from '../packages/contracts/src/api-openapi.ts';
import { apiReferenceMarkdown } from '../packages/contracts/src/api-reference.ts';

it('declares every built-in admin route and gives each operation request and response documentation',()=>{
  const source=readFileSync('apps/web/src/pages/api/[...route].ts','utf8');
  const routes=new Set([...source.matchAll(/action === '([^']+)'/g)].map((match)=>match[1]));
  const declared=new Set(Object.values(adminApi).map((value)=>value.path as string));
  for(const route of routes)expect(declared.has(route),route).toBe(true);
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
  expect(Object.keys(adminApi)).toHaveLength(95);
  expect(readFileSync('docs/api-reference.md','utf8')).toBe(apiReferenceMarkdown());
});
it('checks request revisions and query types with the same rules used by server and client',()=>{
  const write=matchAdminApi('POST','comment')!;
  expect(()=>validateApiInput(write,new URLSearchParams(),{id:'a',status:'pending'})).toThrow();
  expect(()=>validateApiInput(matchAdminApi('GET','comments')!,new URLSearchParams('page=-1'),undefined)).toThrow();
  expect(matchAdminApi('DELETE','entry')).toBeUndefined();
  expect(()=>adminApi.saveSettings.body.parse({value:{},revision:null})).toThrow();
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
