import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';
export function useContentLibrary(state: any, tab: string, setError: (message: string) => void) {
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [filter, setFilter] = useState(''),
    [status, setStatus] = useState('all'),
    [visibility, setVisibility] = useState('all');
  const searchTerm = useDebouncedValue(filter);
  const [libraryPage, setLibraryPage] = useState(1),
    [library, setLibrary] = useState<any>({ items: [], total: 0, pages: 0 });
  const [libraryType, setLibraryType] = useState(''),
    [librarySort, setLibrarySort] = useState('');
  const [bulkIds, setBulkIds] = useState<string[]>([]),
    [bulkOpen, setBulkOpen] = useState(false);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  useEffect(() => {
    setBulkIds([]);
  }, [filter, libraryPage, libraryType, librarySort, fieldFilters, tab, status, visibility]);
  useEffect(() => {
    setLibraryPage(1);
  }, [tab, filter, status, visibility, libraryType, fieldFilters]);
  useEffect(() => {
    setLibraryType('');
    setFieldFilters({});
  }, [tab]);
  useEffect(() => {
    if (!state || !['content', 'pages'].includes(tab)) return;
    let active = true;
    setLibraryLoading(true);
    const params = new URLSearchParams({
      kind: tab === 'pages' ? 'page' : 'content',
      q: searchTerm,
      status,
      visibility,
      type: tab === 'content' ? libraryType : '',
      page: String(libraryPage),
      pageSize: '25',
      sort:
        librarySort ||
        state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort ||
        'title',
      ...Object.fromEntries(
        Object.entries(fieldFilters)
          .filter(([, value]) => value !== '')
          .map(([key, value]) => ['field.' + key, value]),
      ),
    });
    api(`entries/query?${params}`)
      .then((result) => {
        if (active) setLibrary(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLibraryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    state,
    tab,
    searchTerm,
    status,
    visibility,
    libraryType,
    libraryPage,
    fieldFilters,
    librarySort,
  ]);
  return {
    libraryLoading,
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
