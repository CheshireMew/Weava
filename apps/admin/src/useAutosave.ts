import { useEffect, useRef, useState } from 'react';
import type { EditableRecord, EditSession } from './edit-session.ts';
import { connectionFailure, connectionOnline, retryConnection } from './connection-recovery.ts';

export interface AutosaveOptions<R extends EditableRecord> {
  delay?: number;
  paused?: boolean;
  save?: () => Promise<R | null>;
  ready?: (record: R) => boolean;
  incompleteMessage?: string;
}
export type SavePhase = 'saved' | 'pending' | 'saving' | 'error' | 'incomplete' | 'offline' | 'retrying';
export interface AutosaveState {
  phase: SavePhase;
  error: string;
  retry: () => Promise<unknown>;
}

export function useAutosave<R extends EditableRecord>(
  session: EditSession<R>,
  options?: boolean | AutosaveOptions<R>,
) {
  const enabled = !!options,
    config = typeof options === 'object' ? options : {};
  const latest = useRef(config);
  latest.current = config;
  const mounted = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<R | null> | null>(null);
  const recovery = useRef<(() => void) | undefined>(undefined), attempts = useRef(0);
  const [online, setOnline] = useState(connectionOnline);
  const [composing, setComposing] = useState(false);
  const canRetry = useRef(false);
  canRetry.current = enabled && !composing && !config.paused;
  const [state, setState] = useState<{ phase: SavePhase; error: string }>({
    phase: 'saved',
    error: '',
  });
  const key = (record: R | null) => record?.id ?? record?.value.id;
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    recovery.current?.();
    recovery.current = undefined;
  };
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
        const saved = await (latest.current.save?.() ?? session.save());
        attempts.current = 0;
        if (mounted.current && key(session.record) === identity)
          setState({ phase: session.dirty ? 'pending' : 'saved', error: '' });
        return saved;
      } catch (error: any) {
        if (mounted.current && key(session.record) === identity) {
          const transient = connectionFailure(error);
          setState({ phase: transient ? 'retrying' : 'error', error: error.message });
          if (transient && canRetry.current) recovery.current = retryConnection(() => {
            if (mounted.current && canRetry.current && key(session.record) === identity)
              void flushRef.current().catch(() => {});
          }, attempts.current++);
        }
        throw error;
      } finally {
        running.current = null;
      }
    })();
    return running.current;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, []);
  useEffect(() => {
    const update = () => setOnline(connectionOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const start = () => setComposing(true),
      end = () => setComposing(false);
    document.addEventListener('compositionstart', start);
    document.addEventListener('compositionend', end);
    return () => {
      document.removeEventListener('compositionstart', start);
      document.removeEventListener('compositionend', end);
    };
  }, [enabled]);
  const record = session.record;
  const ready = !!record && (!config.ready || config.ready(record));
  useEffect(() => {
    clearTimer();
    if (!enabled) return;
    if (!session.dirty) {
      attempts.current = 0;
      setState({ phase: 'saved', error: '' });
      return;
    }
    setState({
      phase: !online ? 'offline' : ready ? 'pending' : 'incomplete',
      error: ready ? '' : (config.incompleteMessage ?? '请补全当前内容。'),
    });
    if (online && ready && !composing && !config.paused)
      timer.current = setTimeout(() => {
        void flushRef.current().catch(() => {});
      }, latest.current.delay ?? 800);
    return clearTimer;
  }, [enabled, session, record?.id, record?.value, ready, composing, config.paused, online]);
  return {
    ...state,
    phase: session.dirty && !online ? ('offline' as const) : session.dirty && state.phase === 'saved' ? ('pending' as const) : state.phase,
    retry: flush,
    flush,
  };
}
