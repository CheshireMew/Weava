import { useEffect, useRef, useState } from 'react';
import type { EditableRecord, EditSession } from './edit-session.ts';

export interface AutosaveOptions<R extends EditableRecord> {
  delay?: number;
  ready?: (record: R) => boolean;
  incompleteMessage?: string;
}
export type SavePhase = 'saved' | 'pending' | 'saving' | 'error' | 'incomplete';
export interface AutosaveState { phase: SavePhase; error: string; retry: () => Promise<unknown> }

export function useAutosave<R extends EditableRecord>(session: EditSession<R>, options?: boolean | AutosaveOptions<R>) {
  const enabled = !!options, config = typeof options === 'object' ? options : {};
  const latest = useRef(config); latest.current = config;
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<R | null> | null>(null);
  const [composing, setComposing] = useState(false);
  const [state, setState] = useState<{ phase: SavePhase; error: string }>({ phase: 'saved', error: '' });
  const key = (record: R | null) => record?.id ?? record?.value.id;
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  async function flush(): Promise<R | null> {
    clearTimer();
    if (running.current) return running.current;
    if (!session.dirty || !session.record) return session.record;
    if (latest.current.ready && !latest.current.ready(session.record))
      throw new Error(latest.current.incompleteMessage ?? '请补全当前内容后再继续。');
    const identity = key(session.record);
    setState({ phase: 'saving', error: '' });
    running.current = (async () => {
      try {
        const saved = await session.save();
        if (mounted.current && key(session.record) === identity) setState({ phase: session.dirty ? 'pending' : 'saved', error: '' });
        return saved;
      } catch (error: any) {
        if (mounted.current && key(session.record) === identity) setState({ phase: 'error', error: error.message });
        throw error;
      } finally { running.current = null; }
    })();
    return running.current;
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimer(); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const start = () => setComposing(true), end = () => setComposing(false);
    document.addEventListener('compositionstart', start);
    document.addEventListener('compositionend', end);
    return () => { document.removeEventListener('compositionstart', start); document.removeEventListener('compositionend', end); };
  }, [enabled]);
  const record = session.record;
  const ready = !!record && (!config.ready || config.ready(record));
  useEffect(() => {
    clearTimer();
    if (!enabled) return;
    if (!session.dirty) { setState({ phase: 'saved', error: '' }); return; }
    setState({ phase: ready ? 'pending' : 'incomplete', error: ready ? '' : config.incompleteMessage ?? '请补全当前内容。' });
    if (ready && !composing) timer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, latest.current.delay ?? 800);
    return clearTimer;
  }, [enabled, session, record?.id, record?.value, ready, composing]);
  return { ...state, phase: session.dirty && state.phase === 'saved' ? 'pending' as const : state.phase, retry: flush, flush };
}
