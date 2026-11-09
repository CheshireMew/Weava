import {expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureSeo,compareSeo} from '../packages/manager/src/seo-check.ts';
import {maintenanceProbeHeaders,prepareProxy} from '../packages/manager/src/proxy.ts';
import {staticRouteSchema} from '../packages/contracts/src/installation.ts';

async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port;}
async function close(server:Server){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}

it('checks proxy-owned images and redirects through the real static layer while rendering candidate pages independently',async()=>{
 let missing=false;const staticRequests:string[]=[],candidateRequests:string[]=[];
 const page='<html><head><title>文章</title></head><main><h1>文章</h1><img src="/wp-content/uploads/cover.png"><a href="/old/">旧链接</a></main></html>';
 const staticServer=createServer((request,response)=>{
  const path=request.url!;staticRequests.push(path);expect(request.headers['x-weava-upgrade-probe']).toBeUndefined();
  if(path==='/wp-content/uploads/cover.png'){response.writeHead(missing?404:200,{'Content-Type':'image/png'});return response.end('image');}
  if(path==='/wp-content/uploads/alias.png'){response.writeHead(301,{Location:'/wp-content/uploads/cover.png'});return response.end();}
  if(path.startsWith('/wp-content/uploads/')){response.writeHead(404);return response.end();}
  if(path==='/old/'){response.writeHead(301,{Location:'/'});return response.end();}
  if(['/robots.txt','/sitemap.xml'].includes(path)){response.writeHead(404);return response.end();}
  response.writeHead(200,{'Content-Type':'text/html'});response.end(page);
 });
 const candidate=createServer((request,response)=>{
  const path=request.url!;candidateRequests.push(path);expect(request.headers['x-weava-upgrade-probe']).toBe('private-probe');
  if(path.startsWith('/wp-content/uploads/')){response.writeHead(404);return response.end();}
  if(path==='/old/'){response.writeHead(301,{Location:'/'});return response.end();}
  if(['/robots.txt','/sitemap.xml'].includes(path)){response.writeHead(404);return response.end();}
  response.writeHead(200,{'Content-Type':'text/html'});response.end(page);
 });
 const origin=await listen(staticServer),candidateOrigin=await listen(candidate),domain='https://blog.example';
 try{
  const paths=['/','/wp-content/uploads/cover.png','/wp-content/uploads/alias.png','/wp-content/uploads/missing.png'];
  const before=await captureSeo({origin,domain,paths});
  const options={origin:candidateOrigin,domain,paths,headers:{'x-weava-upgrade-probe':'private-probe'},routes:[{prefix:'/wp-content/uploads/',origin}],seed:before};
  const after=await captureSeo(options);
  expect(compareSeo(before,after).passed).toBe(true);
  expect(after.pages['/wp-content/uploads/cover.png'].status).toBe(200);
  expect(after.pages['/wp-content/uploads/alias.png'].status).toBe(301);
  expect(after.pages['/wp-content/uploads/missing.png'].status).toBe(404);
  expect(after.pages['/old/'].status).toBe(301);
  expect(candidateRequests.some(path=>path.startsWith('/wp-content/uploads/'))).toBe(false);
  expect(candidateRequests).toContain('/');expect(staticRequests).toContain('/wp-content/uploads/cover.png');
  missing=true;expect(compareSeo(before,await captureSeo(options)).differences).toEqual(expect.arrayContaining([expect.objectContaining({path:'/wp-content/uploads/cover.png',field:'status',before:200,after:404})]));
 }finally{await close(candidate);await close(staticServer);}
});

it('generates static mappings and a stable private maintenance probe without granting ordinary requests access',()=>{
 const home=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','proxy-'+randomUUID());mkdirSync(home,{recursive:true});
 const route=staticRouteSchema.parse({prefix:'/wp-content/uploads/',directory:join(home,'old uploads')});
 const first=prepareProxy(home,'blog',4324,[route]),headers=maintenanceProbeHeaders(home,'blog');
 const include=readFileSync(first.include,'utf8'),statics=readFileSync(first.staticInclude,'utf8');
 expect(statics).toContain('location ^~ "/wp-content/uploads/"');expect(statics).toContain(route.directory.replaceAll('\\','/')+'/');
 expect(include).toContain('if ($weava_maintenance = 1) { return 503; }');
 expect(include).toContain('$http_x_weava_maintenance_probe = "'+headers['x-weava-maintenance-probe']+'"');
 expect(include).toContain('set $weava_robots_maintenance 0;');expect(include).toContain('if ($weava_robots_maintenance = 1) { return 418; }');
 prepareProxy(home,'blog',4324,[route]);expect(maintenanceProbeHeaders(home,'blog')).toEqual(headers);
 prepareProxy(home,'blog',4324,[{...route,directory:join(home,'different uploads')}]);expect(maintenanceProbeHeaders(home,'blog')).not.toEqual(headers);
 expect(()=>staticRouteSchema.parse({prefix:'/',directory:home})).toThrow();
 expect(()=>staticRouteSchema.parse({prefix:'/a/../uploads/',directory:home})).toThrow();
});
