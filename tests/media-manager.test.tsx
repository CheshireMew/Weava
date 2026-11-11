// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {Window as HappyWindow} from 'happy-dom';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Site,JobRunner,saveMediaGroup,archiveMedia} from '@weava/core';
import {matchAdminApi} from '@weava/contracts/api';
import {createAdminDispatcher} from '../apps/web/src/api/dispatch.ts';
import type {ApiServices,AdminContext} from '../apps/web/src/api/types.ts';
import MediaManager from '../apps/admin/src/MediaManager.tsx';
import {EditSessionsProvider,useEditSessions} from '../apps/admin/src/EditSessions.tsx';
import {SelectorsProvider} from '../apps/admin/src/Selectors.tsx';
import {adminQueries} from '../apps/admin/src/query-cache.ts';
import {mediaUploadSnapshot} from '../apps/admin/src/media-uploads.tsx';

it('WVA-03 preserves metadata through grouped duplicate upload and still saves explicit edits and clears',async()=>{
  const directory=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','media-manager-'+Date.now());
  const site=new Site(directory),jobs=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
  const dispatch=createAdminDispatcher({site,jobs} as ApiServices);
  let heldPath='', held=false, releaseResponse:(()=>void)|undefined;
  let responseGate:Promise<void>|undefined;
  function hold(path:string){heldPath=path;held=false;responseGate=new Promise(resolve=>releaseResponse=resolve);}
  // Real HTTP and the formal dispatcher, upload worker and SQLite store; only
  // authentication and unrelated services are outside this focused integration.
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url!,'http://127.0.0.1'),match=matchAdminApi(request.method!,url.pathname.slice('/api/admin/v1/'.length));
      if(!match){response.writeHead(404).end();return;}
      const chunks:Buffer[]=[];for await(const part of request)chunks.push(Buffer.from(part));
      const bytes=Buffer.concat(chunks),incoming=new Request(url,{method:request.method,headers:request.headers as HeadersInit,...(bytes.length?{body:bytes}:{})});
      const body=match.definition.binary||!bytes.length?undefined:JSON.parse(bytes.toString());
      const result=await dispatch(match.operation,match.params,body,{request:incoming,url} as AdminContext);
      if(url.pathname.endsWith(heldPath)&&heldPath){held=true;await responseGate;heldPath='';}
      response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
    }catch(error:any){response.writeHead(error.status??500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error.message}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  (window as unknown as HappyWindow).happyDOM.setURL(origin);
  const fetch=globalThis.fetch;vi.stubGlobal('fetch',(url:RequestInfo|URL,init?:RequestInit)=>fetch(new URL(String(url),origin),init));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();sessionStorage.clear();adminQueries.resume();
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),errors:string[]=[];
  let manager:ReturnType<typeof useEditSessions>;
  function View(){manager=useEditSessions();return <MediaManager onError={message=>errors.push(message)} onOpen={()=>{}}/>;}
  async function until(check:()=>boolean){
    const deadline=Date.now()+20000;
    while(!check()&&Date.now()<deadline)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
    expect(check(),JSON.stringify(errors)).toBe(true);
  }
  async function change(field:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){
    await act(async()=>{
      const prototype=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:field instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(field,value);
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
    });
  }
  const bytes=readFileSync(resolve('apps/web/public/default-covers/picsum-10.webp'));
  async function upload(){
    await act(async()=>{
      const input=host.querySelector<HTMLInputElement>('input[type=file]')!;
      Object.defineProperty(input,'files',{configurable:true,value:[new File([bytes],'picture.webp',{type:'image/webp'})]});
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>manager!.prepare());
    await until(()=>mediaUploadSnapshot().every(item=>!['queued','uploading'].includes(item.status)));
    expect(mediaUploadSnapshot().filter(item=>item.status==='failed')).toEqual([]);
  }
  try{
    saveMediaGroup(site,{id:'first',label:'第一组'},null);saveMediaGroup(site,{id:'second',label:'第二组'},null);
    await act(async()=>root.render(<EditSessionsProvider><SelectorsProvider><View/></SelectorsProvider></EditSessionsProvider>));
    await until(()=>!!host.querySelector('select[aria-label="媒体分组筛选"] option[value=first]'));
    await change(host.querySelector('select[aria-label="媒体分组筛选"]')!,'first');
    await upload();
    await until(()=>!!host.querySelector('.media-open'));
    await act(async()=>host.querySelector<HTMLButtonElement>('.media-open')!.click());
    const alt=()=>[...host.querySelectorAll('label')].find(label=>label.textContent==='图片说明')!.querySelector('input')!;
    const caption=()=>host.querySelector<HTMLTextAreaElement>('.media-details textarea')!;
    await change(alt(),'原有图片说明');await change(caption(),'原有图注');
    await act(async()=>host.querySelector('[aria-label="图片焦点"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
    await act(async()=>manager!.flush());
    const original=site.store.list('media')[0];
    expect(original.value).toMatchObject({alt:'原有图片说明',caption:'原有图注',groupId:'first'});
    await change(host.querySelector('select[aria-label="媒体分组筛选"]')!,'second');
    await upload();
    const duplicate=site.store.get('media',original.id)!;
    expect(site.store.list('media')).toHaveLength(1);
    expect(duplicate.value).toMatchObject({name:original.value.name,url:original.value.url,alt:'原有图片说明',caption:'原有图注',focalPoint:{x:55,y:50},groupId:'second'});
    expect(alt().value).toBe('原有图片说明');expect(caption().value).toBe('原有图注');
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="媒体所属分组"]')!.value).toBe('second');
    await change(alt(),'更新后的说明');await change(caption(),'更新后的图注');await act(async()=>manager!.flush());
    expect(site.store.get('media',original.id)!.value).toMatchObject({alt:'更新后的说明',caption:'更新后的图注',groupId:'second'});
    await change(alt(),'');await change(caption(),'');await act(async()=>manager!.flush());
    const reopened=new Site(site.root);
    try{expect(reopened.store.get('media',original.id)!.value).toMatchObject({alt:'',caption:'',groupId:'second'});}finally{reopened.close();}
    const button=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===name)!;
    expect(host.querySelector('.media-grid input[type=checkbox]')).toBeNull();
    await change(host.querySelector('select[aria-label="媒体所属分组"]')!,'first');
    await act(async()=>manager!.flush());
    expect(site.store.get('media',original.id)!.value.groupId).toBe('first');
    await change(host.querySelector('select[aria-label="媒体分组筛选"]')!,'first');
    await until(()=>!!host.querySelector('.media-card-actions [aria-label="删除媒体"]'));
    const legacy = site.store.get('media', original.id)!;
    archiveMedia(site, [legacy], true);
    await act(async()=>adminQueries.invalidate());
    await until(()=>!host.querySelector('.media-open'));
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="更多媒体操作"]')!.click());
    await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='查看已归档媒体')!.click());
    await until(()=>!!host.querySelector('.media-open'));
    hold('/media/archive');
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="恢复媒体"]')!.click());
    await until(()=>held);
    await change(alt(),'恢复期间的新说明');
    await act(async()=>{releaseResponse!();await manager!.flush();});
    expect(site.store.get('media',original.id)!.value).toMatchObject({alt:'恢复期间的新说明',archived:false});
    await until(()=>host.textContent?.includes('媒体已恢复')??false);
    await act(async()=>button('返回媒体库').click());
    await until(()=>!!host.querySelector('.media-open'));
    expect(site.store.get('media',original.id)!.value.archived).toBe(false);
    // The media rows below share the original file, so deleting one only removes its record.
    for(let index=0;index<25;index++)site.store.put('media','page-'+index,{...original.value,id:'page-'+index,groupId:'second',archived:false,name:'Page '+index},null);
    await change(host.querySelector('select[aria-label="媒体分组筛选"]')!,'second');
    await act(async()=>adminQueries.invalidate());
    await until(()=>host.querySelectorAll('.media-open').length===24);
    await act(async()=>button('下一页').click());await until(()=>host.querySelectorAll('.media-open').length===1);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="删除媒体"]')!.click());
    await until(()=>!!button('永久删除'));
    expect(site.store.list('media')).toHaveLength(26);
    await act(async()=>button('永久删除').click());
    await until(()=>host.querySelectorAll('.media-open').length===24&&!host.querySelector('.library-pagination'));
    expect(site.store.list('media')).toHaveLength(25);
    expect(readFileSync(join(site.root,original.value.url.slice(1)))).toEqual(bytes);
    expect(errors).toEqual([]);
  }finally{
    releaseResponse?.();
    await act(async()=>root.unmount());host.remove();adminQueries.suspend();vi.unstubAllGlobals();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    jobs.stop();site.close();
  }
},45000);
