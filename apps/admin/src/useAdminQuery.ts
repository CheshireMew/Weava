import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { adminQueries, type QuerySnapshot } from './query-cache.ts';

const empty: QuerySnapshot = { error: '', pending: false, invalidation: 0 };
export function useAdminQuery<T = any>(path: string | null, ttl = 30000) {
  const subscribe = useCallback((listener: () => void) => path ? adminQueries.subscribe(path, listener) : () => {}, [path]);
  const snapshot = useCallback(() => path ? adminQueries.snapshot(path) as QuerySnapshot<T> : empty as QuerySnapshot<T>, [path]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const refresh = useCallback((force = true) => path
    ? adminQueries.read<T>(path, () => api(path as any) as Promise<T>, force, ttl)
    : Promise.resolve(undefined), [path, ttl]);
  useEffect(() => {
    if (!path) return;
    const load = () => { if (document.visibilityState !== 'hidden') void refresh(false).catch(() => {}); };
    // Initial loading also works in background tabs. Subsequent focus checks respect the TTL.
    void refresh(false).catch(() => {});
    window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
    return () => { window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [path, state.invalidation, refresh]);
  return { ...state, loading: !!path && state.data === undefined && !state.error, refreshing: state.pending && state.data !== undefined, refresh };
}
