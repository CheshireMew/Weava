import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { panelUrl } from './admin-location.ts';
import { api } from './api.ts';
import type { ContentState, EntryRecord } from './content-models.ts';
import { adminQueries } from './query-cache.ts';
import { useAdminQuery } from './useAdminQuery.ts';
export const statePath = (panel: string, entryId?: string) =>
  `state?${new URLSearchParams({
    summary: '1',
    panel: ['appearance', 'comments'].includes(panel) ? panel : 'content',
    ...(entryId ? { entryId } : {}),
  })}`;

export function useAdminState({
  authenticated,
  tab,
  activeTab,
  setTab,
  setError,
  currentEntry,
}: {
  authenticated: boolean;
  tab: string;
  activeTab: RefObject<string>;
  setTab: Dispatch<SetStateAction<string>>;
  setError: (message: string) => void;
  currentEntry: () => EntryRecord | null;
}) {
  const [state, setState] = useState<ContentState | null>(null),
    [statePanel, setStatePanel] = useState('');
  const panelPath = statePath(tab);
  const panelQuery = useAdminQuery<ContentState>(authenticated ? panelPath : null);
  useEffect(() => {
    if (!authenticated) {
      setState(null);
      setStatePanel('');
    }
  }, [authenticated]);
  function receiveState(data: ContentState, panel: string) {
    setState(old => currentEntry() && old ? { ...data, schedules: old.schedules } : data);
    setStatePanel(panel);
    const required: Record<string, NonNullable<ContentState['features']>[number]> = {
      content: 'content',
      notes: 'content',
      trash: 'content',
      media: 'media',
      comments: 'engagement',
      analytics: 'analytics',
    };
    if (data.features && required[panel] && !data.features.includes(required[panel])) {
      activeTab.current = 'appearance';
      setTab('appearance');
      history.replaceState(null, '', panelUrl(location.href, 'appearance'));
      return 'appearance';
    }
    return panel;
  }
  useEffect(() => {
    if (panelQuery.data) receiveState(panelQuery.data, tab);
  }, [panelQuery.data, tab]);
  useEffect(() => {
    if (panelQuery.error) setError(panelQuery.error);
  }, [panelQuery.error]);
  async function refresh(panel = activeTab.current, current = () => true, force = true) {
    const path = statePath(panel);
    const data = await adminQueries.read<ContentState>(
      path,
      async () => (await api.request(path)) as ContentState,
      force,
    );
    if (current() && activeTab.current === panel) receiveState(data, panel);
    return data;
  }
  function receiveSchedules(schedules: ContentState['schedules']) {
    setState((old) => (old ? { ...old, schedules } : old));
  }
  const sync = () => refresh(activeTab.current, () => true, false);
  return { state, statePanel, panelQuery, receiveState, receiveSchedules, refresh, sync };
}
