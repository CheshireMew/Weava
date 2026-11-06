import { useCallback, useEffect, useState } from 'react';
import { useAdminQuery } from './useAdminQuery.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';
export function useContentLibrary(state: any, tab: string, setError: (message: string) => void) {
  const [filter, setFilter] = useState(''),
    [status, setStatus] = useState('all'),
    [visibility, setVisibility] = useState('all');
  const searchTerm = useDebouncedValue(filter);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryType, setLibraryType] = useState(''),
    [librarySort, setLibrarySort] = useState('');
  const [bulkIds, setBulkIds] = useState<string[]>([]),
    [bulkOpen, setBulkOpen] = useState(false);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const params = new URLSearchParams({
    kind: 'content', format: tab === 'notes' ? 'note' : 'article', q: searchTerm,
    status: tab === 'notes' ? 'all' : status, visibility: tab === 'notes' ? 'all' : visibility,
    type: tab === 'notes' ? '' : libraryType, page: String(libraryPage), pageSize: '25',
    sort: tab === 'notes' ? '-updatedAt' : librarySort || state?.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || '-updatedAt',
    ...Object.fromEntries(Object.entries(fieldFilters).filter(([, value]) => value !== '').map(([key, value]) => ['field.' + key, value])),
  });
  const queryKey = tab + '?' + params.toString();
  const enabled = !!state && ['content','notes'].includes(tab) && (!state.features || state.features.includes('content'));
  const query = useAdminQuery(enabled ? `entries/query?${params}` : null);
  const [local, setLocal] = useState<{ key: string; source: any; value: any } | null>(null);
  const empty = { items: [], total: 0, pages: 0 };
  const library = local?.key === queryKey && local.source === query.data ? local.value : query.data ?? empty;
  const setLibrary = useCallback((next: React.SetStateAction<any>) => setLocal(previous => {
    const value = previous?.key === queryKey && previous.source === query.data ? previous.value : query.data ?? { items: [], total: 0, pages: 0 };
    return { key: queryKey, source: query.data, value: typeof next === 'function' ? next(value) : next };
  }), [queryKey, query.data]);
  useEffect(() => { if (query.error) setError(query.error); }, [query.error]);
  useEffect(() => {
    setBulkIds([]);
  }, [filter, libraryPage, libraryType, librarySort, fieldFilters, tab, status, visibility]);
  useEffect(() => {
    setLibraryPage(1);
  }, [tab, filter, status, visibility, libraryType, fieldFilters]);
  useEffect(() => {
    setLibraryType('');
    setFieldFilters({});
    setStatus('all');
    setVisibility('all');
    setLibrarySort('');
    setFilter('');
  }, [tab]);
  return {
    libraryLoading: query.loading,
    filter,
    setFilter,
    status,
    setStatus,
    visibility,
    setVisibility,
    searchTerm,
    libraryPage,
    setLibraryPage,
    library,
    setLibrary,
    libraryType,
    setLibraryType,
    librarySort,
    setLibrarySort,
    bulkIds,
    setBulkIds,
    bulkOpen,
    setBulkOpen,
    fieldFilters,
    setFieldFilters,
    items: library.items,
  };
}
