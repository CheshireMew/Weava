import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditSession, type EditableRecord } from './edit-session.ts';
import { Dialog } from './Dialog.tsx';
import { useAutosave, type AutosaveOptions } from './useAutosave.ts';
interface Guard { label: string; dirty: () => boolean; save: () => Promise<any>; discard: () => void; session?: EditSession<any>; closeMessage?: string }
const Context = createContext<{ register: (guard: Guard) => () => void; flush: () => Promise<void>; changed: () => void } | null>(null);
export function EditSessionsProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Set<Guard>()), [,render] = useState(0);
  const [failure,setFailure] = useState<{ guard: Guard; error: string; resolve: (discard: boolean) => void } | null>(null);
  const changed = () => render(value => value + 1);
  const register = (guard: Guard) => { guards.current.add(guard); changed(); return () => { guards.current.delete(guard); changed(); }; };
  async function flush() {
    for (const guard of guards.current) if (guard.dirty()) {
      try { await guard.save(); }
      catch (error: any) {
        const discard = await new Promise<boolean>(resolve => setFailure({guard,error:error.message,resolve}));
        setFailure(null);
        if (!discard) throw new Error('修改仍保留，请处理后再离开。');
        guard.discard();
      }
    }
  }
  const api = useRef({register,flush,changed}); api.current.flush = flush;
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      const guard = [...guards.current].find(guard => guard.dirty());
      if (guard) { event.preventDefault(); event.returnValue=guard.closeMessage ?? '修改没有保存，是否确认关闭'; }
    };
    window.addEventListener('beforeunload',leave); return () => window.removeEventListener('beforeunload',leave);
  },[]);
  return <Context.Provider value={api.current}>{children}
    {[...guards.current].filter(guard=>guard.session?.recovery || guard.session?.notice).map((guard,index)=><div className="recovery-banner" role="status" key={guard.label+index}>{guard.session!.notice || `${guard.label}有浏览器保留的未保存修改。`}{guard.session!.recovery&&<><button onClick={guard.session!.recover}>恢复本地修改</button><button onClick={guard.session!.discardRecovery}>放弃本地副本</button></>}</div>)}
    {failure&&<Dialog label="修改尚未保存" onClose={()=>failure.resolve(false)}><h2>{failure.guard.label}尚未保存</h2><p role="alert">{failure.error}</p><button onClick={()=>failure.resolve(false)}>留在当前页</button><button onClick={()=>failure.resolve(true)}>放弃修改并继续</button></Dialog>}
  </Context.Provider>;
}
export function useEditSessions() { const value=useContext(Context); if (!value) throw new Error('Missing edit session provider'); return value; }
export function useEditGuard(label: string, dirty: () => boolean, save: () => Promise<any>, discard: () => void, session?: EditSession<any>, closeMessage?: string) {
  const manager=useEditSessions(), latest=useRef({dirty,save,discard}); latest.current={dirty,save,discard};
  useEffect(()=>manager.register({label,dirty:()=>latest.current.dirty(),save:()=>latest.current.save(),discard:()=>latest.current.discard(),session,closeMessage}),[manager,label,session,closeMessage]);
}
export function useManagedRecord<R extends EditableRecord>(initial: R | null, write: (record: R) => Promise<R>, label: string, options: { recovery?: boolean; closeMessage?: string; discard?: () => void; saved?: (row: R, snapshot: R, unchanged: boolean) => void; autosave?: boolean | AutosaveOptions<R> } = {}) {
  const manager=useEditSessions(),[,render]=useState(0),latest=useRef(write), latestOptions=useRef(options); latest.current=write; latestOptions.current=options;
  const ref=useRef<EditSession<R> | null>(null);
  if (!ref.current) {
    let storage: Storage | undefined; try { if (options.recovery !== false) storage=window.localStorage; } catch {}
    ref.current=new EditSession(initial,row=>latest.current(row),()=>{render(value=>value+1);queueMicrotask(manager.changed);},storage,'weava-edit:v1:'+label,(...args)=>latestOptions.current.saved?.(...args));
  }
  const session=ref.current;
  useEditGuard(label,()=>session.dirty,session.save,()=>{session.discard();options.discard?.();},options.recovery === false ? undefined : session,options.closeMessage);
  const autoSave = useAutosave(session, options.autosave);
  return {record:session.record,setRecord:session.change,session,autoSave};
}
