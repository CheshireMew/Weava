// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import Comments from '../apps/admin/src/Comments.tsx';
import {EditSessionsProvider,useEditSessions} from '../apps/admin/src/EditSessions.tsx';
import {adminQueries} from '../apps/admin/src/query-cache.ts';
import {defaultSettings} from '@weava/contracts';
import {api} from '../apps/admin/src/api.ts';
vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn()}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,manager:ReturnType<typeof useEditSessions>;
const items=['one','two'].map(id=>({id,entryId:'post',author:id,body:'Existing comment',createdAt:new Date().toISOString(),status:'visible',title:'Post',path:'/post/'}));
function View(){manager=useEditSessions();return <Comments settings={{id:'site',revision:1,updatedAt:'now',value:defaultSettings}} saveSettings={vi.fn()} onError={vi.fn()}/>;}
const mount=()=>act(async()=>root.render(<EditSessionsProvider><View/></EditSessionsProvider>));
const button=(label:string)=>[...host.querySelectorAll('button')].find(button=>button.textContent===label)!;
async function write(value:string){await act(async()=>{const field=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();adminQueries.resume();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(api).mockReset().mockImplementation(async()=>({items,total:2,hasMore:false}) as any);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();});
it('refreshes new comments manually and while visible without losing a reply draft',async()=>{
  vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  await mount();await act(async()=>button('回复').click());await write('保留我的回复');
  let current=[...items,{...items[0],id:'new',author:'新访客'}];
  vi.mocked(api).mockImplementation(async()=>({items:current,total:current.length,hasMore:false}) as any);
  await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(host.textContent).toContain('新访客');expect(host.querySelector('textarea')?.value).toBe('保留我的回复');
  current=[...current,{...items[0],id:'manual',author:'手动刷新访客'}];await act(async()=>button('刷新评论').click());expect(host.textContent).toContain('手动刷新访客');
  const calls=vi.mocked(api).mock.calls.length;vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(api).toHaveBeenCalledTimes(calls);
});
it('ARC-R17 guards navigation without publishing a reply and keeps the draft when leaving is cancelled',async()=>{
 await mount();await act(async()=>button('回复').click());await write('Unpublished reply');let blocked=false,leaving:Promise<void>;
 await act(async()=>{leaving=manager.flush().catch(()=>{blocked=true;});await Promise.resolve();});
 expect(host.textContent).toContain('回复尚未发布');expect(api).not.toHaveBeenCalledWith('comment/reply',expect.anything());
 await act(async()=>{button('留在当前页').click();await leaving!;});expect(blocked).toBe(true);expect(host.querySelector('textarea')?.value).toBe('Unpublished reply');
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenCalledWith('comment/reply',expect.objectContaining({body:'Unpublished reply'}));expect(host.querySelector('textarea')).toBeNull();
});
it('ARC-R17 recovers reply text after reload even when its comment is no longer on the current page',async()=>{
 await mount();await act(async()=>button('回复').click());await write('Recover after reload');
 await act(async()=>root.unmount());root=createRoot(host);adminQueries.invalidate(true);vi.mocked(api).mockResolvedValue({items:[],total:0,hasMore:false} as any);await mount();
 await act(async()=>button('恢复本地修改').click());expect(host.querySelector('textarea')?.value).toBe('Recover after reload');
 const event=new Event('beforeunload',{cancelable:true});await act(async()=>window.dispatchEvent(event));expect(event.defaultPrevented).toBe(true);
});
