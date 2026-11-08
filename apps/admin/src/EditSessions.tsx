import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditSession, type EditableRecord } from './edit-session.ts';
import { Dialog } from './Dialog.tsx';
import { useAutosave, type AutosaveOptions } from './useAutosave.ts';
interface Guard { label: string; dirty: () => boolean; save: () => Promise<any>; discard: () => void; session?: EditSession<any>; closeMessage?: string }
const Context = createContext<{ records:Map<string,EditSession<any>>;preserve:()=>Promise<void>;register: (guard: Guard) => () => void; registerPending: (work: () => Promise<void> | null) => () => void; prepare: () => Promise<void>; flush: () => Promise<void>; changed: () => void } | null>(null);
export function EditSessionsProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Set<Guard>()), [,render] = useState(0);
  const pending = useRef(new Set<() => Promise<void> | null>());
  const records=useRef(new Map<string,EditSession<any>>());
  const allGuards=():Guard[]=>[...guards.current,...[...records.current].filter(([,session])=>![...guards.current].some(guard=>guard.session===session)).map(([label,session])=>({label,session,dirty:()=>session.dirty,save:session.save,discard:session.discard}))];
  const [failure,setFailure] = useState<{ guard: Guard; error: string; resolve: (discard: boolean) => void } | null>(null);
  const changed = () => render(value => value + 1);
  const register = (guard: Guard) => { guards.current.add(guard); changed(); return () => { guards.current.delete(guard); changed(); }; };
  const registerPending = (work: () => Promise<void> | null) => { pending.current.add(work); return () => { pending.current.delete(work); }; };
  async function prepare() {
    for (;;) {
      const work = [...pending.current].map(read => read()).filter((value): value is Promise<void> => !!value);
      if (!work.length) return;
      await Promise.all(work);
    }
  }
  async function flush() {
    await prepare();
    for (const guard of allGuards()) if (guard.dirty()) {
      try { await guard.save(); }
      catch (error: any) {
        const discard = await new Promise<boolean>(resolve => setFailure({guard,error:error.message,resolve}));
        setFailure(null);
        if (!discard) throw new Error('修改仍保留，请处理后再离开。');
        guard.discard();
      }
    }
  }
  async function preserve(){await prepare();for(const guard of allGuards())if(guard.dirty()&&!guard.session)throw new Error(guard.label+'尚未保存，请先保存或明确放弃修改。');await Promise.all([...records.current.values()].map(session=>session.preserve()));}
  const api = useRef({records:records.current,preserve,register,registerPending,prepare,flush,changed}); api.current.flush = flush;api.current.preserve=preserve;
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      const guard = allGuards().find(guard => guard.dirty());
      if (guard || [...pending.current].some(read => !!read())) { event.preventDefault(); event.returnValue=guard?.closeMessage ?? '有图片尚未处理完成，请处理后再关闭。'; }
    };
    window.addEventListener('beforeunload',leave); return () => window.removeEventListener('beforeunload',leave);
  },[]);
  return <Context.Provider value={api.current}>{children}
    {[...guards.current].filter(guard=>guard.session?.recovery || guard.session?.notice).map((guard,index)=><div className="recovery-banner" role="status" key={guard.label+index}>{guard.session!.notice || `${guard.label}有浏览器保留的未保存修改。`}{guard.session!.recovery&&<><button onClick={guard.session!.recover}>恢复本地修改</button><button onClick={guard.session!.discardRecovery}>放弃本地副本</button></>}</div>)}
    {failure&&<Dialog label="修改尚未保存" onClose={()=>failure.resolve(false)}><h2>{failure.guard.label}尚未保存</h2><p role="alert">{failure.error}</p><div className="dialog-actions"><button onClick={()=>failure.resolve(false)}>留在当前页</button><button onClick={()=>failure.resolve(true)}>放弃修改并继续</button></div></Dialog>}
  </Context.Provider>;
}
export function useEditSessions() { const value=useContext(Context); if (!value) throw new Error('Missing edit session provider'); return value; }
export function usePendingEditWork(work: () => Promise<void> | null) {
  const manager = useContext(Context), latest = useRef(work); latest.current = work;
  useEffect(() => manager?.registerPending(() => latest.current()), [manager]);
}
export function useEditGuard(label: string, dirty: () => boolean, save: () => Promise<any>, discard: () => void, session?: EditSession<any>, closeMessage?: string) {
  const manager=useEditSessions(), latest=useRef({dirty,save,discard}); latest.current={dirty,save,discard};
  useEffect(()=>manager.register({label,dirty:()=>latest.current.dirty(),save:()=>latest.current.save(),discard:()=>latest.current.discard(),session,closeMessage}),[manager,label,session,closeMessage]);
}
export function useManagedRecord<R extends EditableRecord>(initial: R | null, write: (record: R) => Promise<R>, label: string, options: { recovery?: boolean; closeMessage?: string; discard?: () => void; saved?: (row: R, snapshot: R, unchanged: boolean) => void; preserve?:(row:R)=>Promise<void>;autosave?: boolean | AutosaveOptions<R> } = {}) {
  const manager=useEditSessions(),[,render]=useState(0),latest=useRef(write), latestOptions=useRef(options); latest.current=write; latestOptions.current=options;
  const ref=useRef<EditSession<R> | null>(null);
  if (!ref.current) {
    let storage: Storage | undefined; try { if (options.recovery !== false) storage=window.localStorage; } catch {}
    const retained=manager.records.get(label) as EditSession<R>|undefined;
    ref.current=retained&&(retained.dirty||retained.saving)?retained:new EditSession(initial,write,()=>{},storage,'weava-edit:v1:'+label);
    manager.records.set(label,ref.current);
  }
  const session=ref.current;
  session.rebind(row=>{
      const autosave=latestOptions.current.autosave;
      if(typeof autosave==='object'&&autosave.ready&&!autosave.ready(row))throw new Error(autosave.incompleteMessage??'请补全当前内容后再继续。');
      return latest.current(row);
    },()=>{render(value=>value+1);queueMicrotask(manager.changed);},(...args)=>latestOptions.current.saved?.(...args),options.preserve?row=>latestOptions.current.preserve!(row):undefined);
  useEffect(()=>()=>{if(!session.dirty&&!session.saving&&manager.records.get(label)===session)manager.records.delete(label);},[manager,label,session]);
  useEditGuard(label,()=>session.dirty,session.save,()=>{session.discard();options.discard?.();},session,options.closeMessage);
  const autoSave = useAutosave(session, options.autosave);
  return {record:session.record,setRecord:session.change,session,autoSave};
}
