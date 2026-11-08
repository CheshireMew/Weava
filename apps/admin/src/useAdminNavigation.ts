import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { adminPanel, entryUrl, panelUrl } from './admin-location.ts';
import type { ContentState } from './content-models.ts';
import { adminQueries } from './query-cache.ts';
import { statePath } from './useAdminState.ts';
import type { useContentWorkspace } from './useContentWorkspace.ts';
export function useAdminNavigation({
  tab,
  setTab,
  activeTab,
  authenticated,
  ready,
  selection,
  editors,
  receiveState,
  setMenu,
  setError,
  preloadPanel,
}: {
  tab: string;
  setTab: Dispatch<SetStateAction<string>>;
  activeTab: RefObject<string>;
  authenticated: boolean;
  ready: boolean;
  selection: ReturnType<typeof useContentWorkspace>['navigation'];
  editors: { flush: () => Promise<void> };
  receiveState: (data: ContentState, panel: string) => string;
  setMenu: (open: boolean) => void;
  setError: (message: string) => void;
  preloadPanel: (panel: string) => void;
}) {
  const navigationVersion = useRef(0),
    historyVersion = useRef(0);
  useEffect(() => {
    if (!authenticated || !ready) return;
    let active = true;
    const version = navigationVersion.current;
    const entryId = ['content', 'notes'].includes(tab)
      ? new URLSearchParams(window.location.search).get('entry')
      : null;
    if (entryId && !selection.current() && version === 0)
      selection.select(entryId).catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [authenticated, ready]);
  async function navigate(next: string, recordHistory = true) {
    if (recordHistory) ++historyVersion.current;
    if (next === activeTab.current) {
      ++navigationVersion.current;
      setMenu(false);
      return true;
    }
    preloadPanel(next);
    const version = ++navigationVersion.current;
    selection.cancelSelection();
    try {
      await editors.flush();
      if (version !== navigationVersion.current) return true;
      selection.clear(false);
      activeTab.current = next;
      const cached = adminQueries.snapshot(statePath(next)).data;
      if (cached) next = receiveState(cached, next);
      setTab(next);
      setMenu(false);
      if (recordHistory && next !== tab)
        window.history.pushState(null, '', panelUrl(window.location.href, next));
      return true;
    } catch (error: any) {
      if (version !== navigationVersion.current) return true;
      setError(error.message);
      return false;
    }
  }
  useEffect(() => {
    const back = async () => {
      const version = ++historyVersion.current,
        href = window.location.href;
      const current = () => version === historyVersion.current && href === window.location.href;
      const next = adminPanel(window.location.search);
      const entryId = new URLSearchParams(window.location.search).get('entry');
      const restore = () =>
        window.history.replaceState(
          null,
          '',
          entryUrl(
            panelUrl(window.location.href, activeTab.current),
            selection.current()?.id ?? null,
          ),
        );
      try {
        if (next !== tab && !(await navigate(next, false))) {
          if (current()) restore();
          return;
        }
        if (!current()) return;
        if (['content', 'notes'].includes(next)) {
          if (entryId && entryId !== selection.current()?.id) {
            await selection.select(entryId, false);
            if (current() && selection.current()?.id !== entryId) restore();
          } else if (!entryId && selection.current()) {
            await editors.flush();
            if (current()) selection.clear(false);
          }
        }
      } catch (error: any) {
        if (current()) {
          setError(error.message);
          restore();
        }
      }
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [tab, authenticated]);
  return navigate;
}
