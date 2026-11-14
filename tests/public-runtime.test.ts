import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Site} from '../packages/core/src/site.ts';
import {entrySchema} from '@weava/contracts';
import {selectPublicPage} from '../packages/core/src/public-page-selection.ts';
import {BusinessStore,websiteContext} from '../packages/core/src/site-sdk.ts';
const runtime=vi.hoisted(()=>({site:undefined as unknown as Site,transform:vi.fn(async(html:string,_release:any)=>html)}));
vi.mock('../apps/web/src/runtime.ts',()=>({get site(){return runtime.site;},siteExtension:Promise.resolve({route:async()=>null,transformHtml:runtime.transform}),features:['content'],analytics:{},maintenance:false,validating:false,ready:true,siteRenderer:Promise.resolve(null),contextFor:vi.fn()}));
import {onRequest} from '../apps/web/src/middleware.ts';
const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','public-runtime-'+randomUUID());let sequence=0;
beforeEach(()=>{
  vi.stubEnv('DEV',false);vi.stubEnv('WEAVA_PUBLIC_CACHE_SECONDS','30');runtime.transform.mockClear();
  const site=runtime.site=new Site(join(base,String(sequence++))),settings=site.settings();
  site.saveSettings({...settings.value,domain:'https://audit.test',language:'zh-CN'},settings.revision);
  site.saveEntry(entrySchema.parse({id:'page',kind:'page',path:'/page/',title:'Page',status:'published'}),null);site.publish();
});
afterEach(()=>{runtime.site.close();vi.unstubAllEnvs();});
const context=(path:string,headers?:HeadersInit)=>({request:new Request('https://audit.test'+path,{headers}),url:new URL('https://audit.test'+path),locals:{},clientAddress:'127.0.0.1',cookies:{get:()=>undefined}} as any);
it('pins the page, final transform and cached response to one release while a publication commits',async()=>{
  const ctx=context('/page/'),original=runtime.site.release()!;
  const response=await onRequest(ctx,async()=>{
    const page=selectPublicPage(runtime.site,ctx.url,false,ctx.locals.weavaRelease);ctx.locals.weavaRelease=page.release;
    const settings=runtime.site.settings();runtime.site.saveSettings({...settings.value,language:'en'},settings.revision);runtime.site.publish({scope:'settings'});
    return new Response('<html><button data-copy-code>复制代码</button></html>',{headers:{'Content-Type':'text/html'}});
  });
  expect(runtime.transform.mock.calls[0][1].id).toBe(original.id);expect(await response!.text()).toContain('复制代码');
  const render=vi.fn(async()=>new Response('<html>New page</html>',{headers:{'Content-Type':'text/html'}}));
  await onRequest(context('/page/'),render);expect(render).toHaveBeenCalledTimes(1);
  await onRequest(context('/page/'),render);expect(render).toHaveBeenCalledTimes(1);expect(runtime.transform).toHaveBeenCalledTimes(2);
});
it('uses draft settings for the final preview transform and the custom-page SDK',async()=>{
  const settings=runtime.site.settings();runtime.site.saveSettings({...settings.value,language:'en'},settings.revision);
  const ctx=context('/__preview/page');let preview:any;
  const response=await onRequest(ctx,async()=>{
    preview=selectPublicPage(runtime.site,ctx.url,true,ctx.locals.weavaRelease);ctx.locals.weavaRelease=preview.release;
    return new Response('<html><button data-copy-code>复制代码</button></html>',{headers:{'Content-Type':'text/html','Cache-Control':'private, no-store'}});
  });
  expect(await response!.text()).toContain('Copy code');expect(runtime.transform.mock.calls[0][1].settings.language).toBe('en');
  const business=new BusinessStore(runtime.site.root,'migrate');
  try{const sdk=websiteContext(runtime.site,business,{enqueue:vi.fn()},ctx.request,true,preview.entry,false,preview.release);expect(sdk.settings.language).toBe('en');expect(sdk.content.get('page').id).toBe('page');}finally{business.close();}
});
it('revalidates stable public asset URLs after replacement',async()=>{
  const folder=join(runtime.site.root,'public');mkdirSync(folder);const file=join(folder,'logo.svg');writeFileSync(file,'<svg>old</svg>');
  const first=await onRequest(context('/site-assets/logo.svg'),vi.fn());expect(first!.headers.get('Cache-Control')).toBe('public, no-cache');const etag=first!.headers.get('ETag')!;
  writeFileSync(file,'<svg>replacement</svg>');const second=await onRequest(context('/site-assets/logo.svg',{'If-None-Match':etag}),vi.fn());
  expect(second!.status).toBe(200);expect(await second!.text()).toContain('replacement');
});
