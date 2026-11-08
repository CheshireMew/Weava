import type { ApiOutput } from '@weava/contracts/api';
import { useEffect, useState } from 'react';
import { useAdminQuery } from './useAdminQuery.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';
import { adminQueries } from './query-cache.ts';
export function useMediaLibrary(onError: (message: string) => void) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [page, setPage] = useState(1),
    [archived, setArchived] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const searchTerm = useDebouncedValue(query);
  const [group, setGroup] = useState('');
  const groupQuery = useAdminQuery<ApiOutput<'groups'>>('media/groups'),
    groups = groupQuery.data ?? [];
  const queryPath = (page: number) => `media/query?${new URLSearchParams({ q: searchTerm, kind, page: String(page), pageSize: '24', archived: String(archived), group })}`;
  const path = queryPath(page);
  const queryResult = useAdminQuery<ApiOutput<'mediaQuery'>>(path);
  const result = queryResult.data ?? { items: [], pages: 0, total: 0 },
    loading = queryResult.loading;
  const refresh = () => setEpoch((value) => value + 1);
  useEffect(() => { setChecked([]); }, [path]);
  useEffect(() => {
    if (epoch) {
      void queryResult.refresh().catch(() => {});
      void groupQuery.refresh().catch(() => {});
    }
  }, [epoch]);
  useEffect(() => {
    setChecked(previous => previous.filter(id => queryResult.data?.items.some(row => row.id === id)));
  }, [queryResult.data]);
  useEffect(() => {
    if (!queryResult.data || queryResult.pending || queryResult.error || page <= Math.max(1, queryResult.data.pages)) return;
    let active = true;
    // A cached empty page may have been invalidated by an upload or a move.
    // Reuse the current query and clamp only after its fresh result arrives.
    void queryResult.refresh(false).then(result => {
      if (active && result && page > Math.max(1, result.pages)) {
        const lastPage = Math.max(1, result.pages);
        adminQueries.invalidate(false, path => path === queryPath(lastPage));
        setPage(lastPage);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [queryResult.data, queryResult.pending, queryResult.error, queryResult.refresh, page]);
  useEffect(() => {
    if (queryResult.error || groupQuery.error) onError(queryResult.error || groupQuery.error);
  }, [queryResult.error, groupQuery.error]);
  return {
    query,
    setQuery,
    kind,
    setKind,
    page,
    setPage,
    archived,
    setArchived,
    checked,
    setChecked,
    group,
    setGroup,
    groups,
    result,
    loading,
    refresh,
    searchTerm,
  };
}
