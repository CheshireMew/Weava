// @vitest-environment happy-dom
import {act,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ErrorBoundary,retryableLazy} from '../apps/admin/src/ErrorBoundary.tsx';
import {EditSessionsProvider,useManagedRecord,useEditSessions} from '../apps/admin/src/EditSessions.tsx';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
it('retries a rejected lazy import without reloading the whole workspace',async()=>{
 const load=vi.fn().mockRejectedValueOnce(new Error('chunk missing')).mockResolvedValue({default:()=> <p>Loaded panel</p>}),Panel=retryableLazy(load);
 await act(async()=>root.render(<ErrorBoundary><Suspense fallback="Loading"><Panel/></Suspense></ErrorBoundary>));expect(host.textContent).toContain('暂时无法打开');
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='重试')!.click());expect(host.textContent).toBe('Loaded panel');expect(load).toHaveBeenCalledTimes(2);
});
it('retains the edit session across a panel crash and preserves its current data before reload',async()=>{
 let model:any,manager:any,fail=false,reloaded=false;
 function Panel(){manager=useEditSessions();model=useManagedRecord({id:'entry',revision:1,value:{text:'server'}},async row=>row,'Retained editor');if(fail)throw new Error('render failed');return <input aria-label="text" value={model.record.value.text} readOnly/>;}
 function View(){const editors=useEditSessions();return <ErrorBoundary onReload={async()=>{await editors.preserve();reloaded=true;}}><Panel/></ErrorBoundary>;}
 const render=()=>root.render(<EditSessionsProvider><View/></EditSessionsProvider>);
 await act(async()=>render());await act(async()=>model.setRecord((row:any)=>({...row,value:{text:'unsaved'}})));const session=model.session;
 fail=true;await act(async()=>render());expect(manager.records.get('Retained editor')).toBe(session);
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='重新载入后台')!.click());expect(reloaded).toBe(true);expect(localStorage.getItem('weava-edit:v1:Retained editor:entry')).toContain('unsaved');
 fail=false;await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='重试')!.click());expect(model.session).toBe(session);expect(host.querySelector('input')?.value).toBe('unsaved');
});
it('does not reload if durable recovery fails',async()=>{
 const reload=vi.fn(async()=>{throw new Error('quota');});function Broken(){throw new Error('broken');return null;}
 await act(async()=>root.render(<ErrorBoundary onReload={reload}><Broken/></ErrorBoundary>));await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='重新载入后台')!.click());expect(host.textContent).toContain('无法保留修改');
});
