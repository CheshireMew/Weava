// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {useMediaLibrary} from '../apps/admin/src/useMediaLibrary.ts';
import {adminQueries} from '../apps/admin/src/query-cache.ts';

it('waits for an invalidated cached page, then clamps after the last item is removed',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  adminQueries.resume();
  let library!:ReturnType<typeof useMediaLibrary>,total=25,finish!:(value:Response)=>void,requested=false;
  const result=(page:number,count:number)=>({items:[],total:count,page,pageSize:24,pages:Math.ceil(count/24)});
  let delay=true;
  vi.stubGlobal('fetch',async(input:any)=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname.endsWith('/media/groups'))return Response.json([]);
    const page=Number(url.searchParams.get('page'));
    if(page===2&&delay){requested=true;return new Promise<Response>(resolve=>finish=resolve);}
    return Response.json(result(page,total));
  });
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),errors:string[]=[];
  function View(){library=useMediaLibrary(message=>errors.push(message));return <p>{library.page}</p>;}
  const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  const until=async(check:()=>boolean)=>{const deadline=Date.now()+3000;while(!check()&&Date.now()<deadline)await settle();expect(check(),errors.join(', ')).toBe(true);};
  try{
    await act(async()=>root.render(<View/>));await until(()=>!library.loading&&library.result.total===25);
    const path='media/query?'+new URLSearchParams({q:'',kind:'',page:'2',pageSize:'24',archived:'false',group:''});
    await adminQueries.read(path,async()=>result(2,24));adminQueries.invalidate(false,key=>key===path);
    await act(async()=>library.setPage(2));await until(()=>requested);
    expect(requested).toBe(true);expect(library.page).toBe(2);
    await act(async()=>{delay=false;finish(Response.json(result(2,25)));});await until(()=>!library.loading&&library.result.total===25);
    expect(library.page).toBe(2);
    total=24;await act(async()=>library.refresh());await until(()=>library.page===1&&!library.loading&&library.result.total===24);
    expect(library.page).toBe(1);expect(library.result.total).toBe(24);expect(errors).toEqual([]);
  }finally{finish?.(Response.json(result(2,total)));await act(async()=>root.unmount());host.remove();adminQueries.suspend();vi.unstubAllGlobals();}
});
