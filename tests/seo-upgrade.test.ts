import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {analyzePage,captureSeo,compareSeo,upgradeProbePath,type SeoSnapshot} from '../packages/manager/src/seo-check.ts';
import {Site} from '../packages/core/src/site.ts';
import {siteStamp,publicInventory} from '../packages/manager/src/public-inventory.ts';
import {onlineWorkspace} from '../packages/manager/src/operations.ts';
import {saveInstallation,hash} from '../packages/manager/src/state.ts';
const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/seo-upgrade-20261105';
const domain='https://blog.example';
const html=(extra='')=>`<!doctype html><html><head><title>文章</title><meta name="description" content="摘要"><link rel="canonical" href="${domain}/post/"><meta name="robots" content="index,follow"><script type="application/ld+json">{"@type":"Article","headline":"文章"}</script>${extra}</head><body><main><h1>文章</h1><article>原始正文</article><a href="?page=2">下一页</a><img src="/media/cover.png"></main><section id="comments">会变化的评论</section></body></html>`;
function snapshot(value:string){return {version:1,domain,createdAt:'now',pages:{'/post/':analyzePage(value,200,new Headers({'content-type':'text/html'}),domain,'/post/').page},sitemaps:{'/sitemap.xml':{status:200,urls:[domain+'/post/']}},robots:{status:200,text:'User-agent: *\nDisallow: /admin/'},resources:{'/media/cover.png':200}} as SeoSnapshot;}
describe('SEO protection during upgrades',()=>{
 it('ARC-R06 probes real versioned image URLs and compares their stable identity across builds',async()=>{
  let build='one',missing=false;const requested:string[]=[];
  const server=createServer((request,response)=>{
   if(request.method==='HEAD'){requested.push(request.url!);response.writeHead(request.url==='/_site/'+build+'/logo.png'&&!missing?200:404);return response.end();}
   if(['/robots.txt','/sitemap.xml'].includes(request.url!)){response.writeHead(404);return response.end();}
   response.setHeader('content-type','text/html');response.end('<html><main><h1>Page</h1><img src="/_site/'+build+'/logo.png"></main></html>');
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const options={origin:'http://127.0.0.1:'+(server.address() as any).port,domain,paths:['/']},before=await captureSeo(options);
   build='two';const changedBuild=await captureSeo({...options,seed:before});expect(compareSeo(before,changedBuild).passed).toBe(true);
   missing=true;const broken=await captureSeo({...options,seed:before});expect(compareSeo(before,broken).differences).toContainEqual({path:'/_site/%7Bbuild%7D/logo.png',field:'resource-status',before:200,after:404});
   expect(requested).toEqual(['/_site/one/logo.png','/_site/two/logo.png','/_site/two/logo.png']);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('ARC-R16 keeps the missing-page comparison identity stable for the same exact upgrade',()=>{
  const attempt=(operation:string)=>{
    const path=upgradeProbePath('same-data','same-program','same-build'),before=snapshot(html()),after=snapshot(html());
    before.pages[path]={status:404,type:'text/html',title:['Old']};after.pages[path]={status:404,type:'text/html',title:['New']};
    const differences=compareSeo(before,after).differences;
    return {operation,differences,approval:hash(JSON.stringify({stamp:'same-data',target:'same-program',buildHash:'same-build',domain,differences}))};
  };
  const first=attempt(randomUUID()),second=attempt(randomUUID());expect(first.operation).not.toBe(second.operation);expect(first.differences.length).toBeGreaterThan(0);expect(second.approval).toBe(first.approval);
  expect(upgradeProbePath('changed-data','same-program','same-build')).not.toBe(upgradeProbePath('same-data','same-program','same-build'));
 });
 it('retries transient resource errors but still reports persistent failures',async()=>{
  const calls=new Map<string,number>();
  const server=createServer((request,response)=>{
   const path=request.url!;
   if(['/robots.txt','/sitemap.xml'].includes(path)){response.writeHead(404);return response.end();}
   if(request.method==='HEAD'){
    const count=(calls.get(path)??0)+1;calls.set(path,count);
    response.writeHead(path==='/persistent.png'||count===1?502:200);return response.end();
   }
   response.setHeader('content-type','text/html');response.end('<html><main><h1>Page</h1><img src="/transient.png"><img src="/persistent.png"></main></html>');
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const result=await captureSeo({origin:'http://127.0.0.1:'+(server.address() as any).port,domain,paths:['/']});
   expect(result.resources['/transient.png']).toBe(200);expect(calls.get('/transient.png')).toBe(2);
   expect(result.resources['/persistent.png']).toBe(502);expect(calls.get('/persistent.png')).toBe(3);
   const baseline=structuredClone(result);baseline.resources['/persistent.png']=200;
   expect(compareSeo(baseline,result).differences).toContainEqual({path:'/persistent.png',field:'resource-status',before:200,after:502});
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 for(const [field,replacement]of [
  ['content',(h:string)=>h.replace('原始正文','错误的正文')],
  ['title',(h:string)=>h.replace('<title>文章</title>','<title>错误标题</title>')],
  ['description',(h:string)=>h.replace('content="摘要"','content="错误摘要"')],
  ['canonical',(h:string)=>h.replace('href="'+domain+'/post/"','href="https://wrong.example/post/"')],
  ['robots',(h:string)=>h.replace('index,follow','noindex,nofollow')],
  ['schema',(h:string)=>h.replace('"@type":"Article"','"@type":"Product"')],
  ['links',(h:string)=>h.replace('?page=2','?page=3')],
  ['images',(h:string)=>h.replace('/media/cover.png','/media/missing.png')],
 ] as const)it('blocks an unintended change in '+field,()=>{const report=compareSeo(snapshot(html()),snapshot(replacement(html())));expect(report.passed).toBe(false);expect(report.differences.some(item=>item.field===field)).toBe(true);});
 it('ignores script, CSS, whitespace, schema key order and live comments while retaining content',()=>{
  const updated=html('<style>body{color:red}</style><script>changed()</script>').replace('原始正文',' 原始正文  ').replace('会变化的评论','另一条新评论').replace('{"@type":"Article","headline":"文章"}','{"headline":"文章","@type":"Article"}');expect(compareSeo(snapshot(html()),snapshot(updated)).passed).toBe(true);
 });
 it('checks real headers, redirects, missing pages, sitemap membership, robots rules and media',()=>{
  const a=snapshot(html()),b=structuredClone(a);b.pages['/post/'].status=404;b.robots.text+='\nDisallow: /';b.sitemaps['/sitemap.xml'].urls=[];b.resources['/media/cover.png']=404;
  const fields=compareSeo(a,b).differences.map(item=>item.field);expect(fields).toEqual(expect.arrayContaining(['status','policy','sitemap','resource-status']));
  expect(analyzePage('',301,new Headers({location:'/post/'}),domain,'/old/').page.location).toBe(domain+'/post/');
  expect(analyzePage(html(),200,new Headers({'content-type':'text/html','x-robots-tag':'noindex'}),domain,'/post/').page.robots).toContain('noindex');
 });
 it('crawls every public page, relative pagination, sitemap and redirect anonymously',async()=>{
  const visited=new Set<string>(),server=createServer((request,response)=>{
   expect(request.headers.authorization).toBeUndefined();expect(request.headers.cookie).toBeUndefined();visited.add(request.url!);
   if(request.url==='/robots.txt'){response.setHeader('content-type','text/plain');return response.end('User-agent: *\nDisallow: /admin/');}
   if(request.url==='/sitemap.xml'){response.setHeader('content-type','application/xml');return response.end('<urlset><url><loc>'+domain+'/post/</loc></url></urlset>');}
   if(request.url==='/old/'){response.writeHead(301,{Location:'/post/'});return response.end();}
   if(request.url?.startsWith('/media/'))return response.end('image');
   response.setHeader('content-type','text/html');response.end(html());
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{const origin='http://127.0.0.1:'+(server.address() as any).port,result=await captureSeo({origin,domain,paths:['/post/'],redirects:['/old/']});expect(result.pages['/post/?page=2'].status).toBe(200);expect(result.pages['/old/'].status).toBe(301);expect(visited.has('/media/cover.png')).toBe(true);await expect(captureSeo({origin,domain,paths:[],headers:{Cookie:'owner'}})).rejects.toThrow(/匿名/);}
  finally{await new Promise<void>(r=>server.close(()=>r()));}
 });
 it('prepares an online database snapshot and rejects changed authored or extension state without tracking ordinary visits',async()=>{
  const root=join(base,'snapshot-'+randomUUID()),site=new Site(join(root,'site')),home=join(root,'installation');mkdirSync(home,{recursive:true});
  saveInstallation(home,{version:1,id:randomUUID(),node:process.execPath,sitesRoot:root,backupRoot:join(root,'work'),programs:{},sites:{}});
  writeFileSync(join(site.root,'site.json'),JSON.stringify({version:2,id:'example',port:4900,features:[],template:'blank'}));writeFileSync(join(site.root,'program.json'),'{}');
  const before=siteStamp(site.root),workspace=await onlineWorkspace(home,site.root,{root:'program',manifest:{id:'target'},manifestHash:hash('target')});expect(workspace.stamp).toBe(before);
  site.store.setState('last-visit','now');expect(siteStamp(site.root)).toBe(before);
  mkdirSync(join(site.root,'extensions/state'),{recursive:true});writeFileSync(join(site.root,'extensions/state/quotes.json'),'{"price":1}');expect(siteStamp(site.root)).toBe(before);
  writeFileSync(join(site.root,'extensions/state/quotes.json'),'{"price":2}');expect(siteStamp(site.root)).toBe(before);
  const settings=site.settings();site.saveSettings({...settings.value,name:'新名字'},settings.revision);expect(siteStamp(site.root)).not.toBe(before);
  const after=siteStamp(site.root);writeFileSync(join(site.root,'extensions/index.mjs'),'export default()=>({});');expect(siteStamp(site.root)).not.toBe(after);
  expect(publicInventory(site.root).paths).toEqual([]);site.close();
 });
 it('allows only declared temporary random redirects to existing public targets',async()=>{
  let destination='/one/',status=302;
  const server=createServer((request,response)=>{if(request.url==='/random/'){response.writeHead(status,{Location:destination});return response.end();}if(['/robots.txt','/sitemap.xml'].includes(request.url!)){response.writeHead(404);return response.end();}response.setHeader('content-type','text/html');response.end('<html><h1>文章</h1></html>');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{const options={origin:'http://127.0.0.1:'+(server.address() as any).port,domain,paths:['/one/','/two/'],dynamicRedirects:{'/random/':{status:302,targets:[domain+'/one/',domain+'/two/']}}};
   const before=await captureSeo(options);destination='/two/';const after=await captureSeo(options);expect(compareSeo(before,after).passed).toBe(true);
   destination='https://unapproved.example/';expect(compareSeo(before,await captureSeo(options)).passed).toBe(false);
   destination='/one/';status=301;expect(compareSeo(before,await captureSeo(options)).passed).toBe(false);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
 });
});
