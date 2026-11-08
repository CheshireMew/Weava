import { useCallback, useEffect, useState } from 'react';
import type { ContentPage, ContentWorkspaceData, EntryRecord } from './content-models.ts';
import { useAdminQuery } from './useAdminQuery.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';
interface LibraryView {
  filter: string;
  status: string;
  visibility: string;
  page: number;
  type: string;
  sort: string;
  fields: Record<string, string>;
}
const initialView = (): LibraryView => ({ filter: '', status: 'all', visibility: 'all', page: 1, type: '', sort: '', fields: {} });
export function useContentLibrary(
  state: Pick<ContentWorkspaceData, 'types' | 'features'> | null,
  tab: string,
  setError: (message: string) => void,
) {
  const format = tab === 'notes' ? 'note' : 'article';
  const [views, setViews] = useState({ article: initialView(), note: initialView() });
  const { filter, status, visibility, page: libraryPage, type: libraryType, sort: librarySort, fields: fieldFilters } = views[format];
  const change = useCallback(<K extends keyof LibraryView>(key: K, next: React.SetStateAction<LibraryView[K]>) => {
    setViews(previous => {
      const current = previous[format];
      const value = typeof next === 'function' ? (next as (old: LibraryView[K]) => LibraryView[K])(current[key]) : next;
      return { ...previous, [format]: { ...current, [key]: value, ...(key === 'page' ? {} : { page: 1 }) } };
    });
  }, [format]);
  const setFilter = (value: React.SetStateAction<string>) => change('filter', value);
  const setStatus = (value: React.SetStateAction<string>) => change('status', value);
  const setVisibility = (value: React.SetStateAction<string>) => change('visibility', value);
  const setLibraryPage = (value: React.SetStateAction<number>) => change('page', value);
  const setLibraryType = (value: React.SetStateAction<string>) => change('type', value);
  const setLibrarySort = (value: React.SetStateAction<string>) => change('sort', value);
  const setFieldFilters = (value: React.SetStateAction<Record<string, string>>) => change('fields', value);
  const searchTerm = useDebouncedValue(filter, 180, format);
  const [bulkIds, setBulkIds] = useState<string[]>([]),
    [bulkOpen, setBulkOpen] = useState(false);
  const params = new URLSearchParams({
    kind: 'content',
    format: tab === 'notes' ? 'note' : 'article',
    q: searchTerm,
    status: tab === 'notes' ? 'all' : status,
    visibility: tab === 'notes' ? 'all' : visibility,
    type: tab === 'notes' ? '' : libraryType,
    page: String(libraryPage),
    pageSize: '25',
    sort:
      tab === 'notes'
        ? '-updatedAt'
        : librarySort ||
          state?.types.find((row) => row.id === libraryType)?.value.admin?.sort ||
          '-updatedAt',
    ...Object.fromEntries(
      Object.entries(fieldFilters)
        .filter(([, value]) => value !== '')
        .map(([key, value]) => ['field.' + key, value]),
    ),
  });
  const queryKey = format + '?' + params.toString();
  const enabled =
    !!state &&
    ['content', 'notes'].includes(tab) &&
    (!state.features || state.features.includes('content'));
  const query = useAdminQuery<ContentPage>(enabled ? `entries/query?${params}` : null);
  const [local, setLocal] = useState<{
    key: string;
    source: ContentPage | undefined;
    value: ContentPage;
  } | null>(null);
  const empty: ContentPage = { items: [], total: 0, pages: 0, page: 1, pageSize: 25 };
  const library =
    local?.key === queryKey && local.source === query.data ? local.value : (query.data ?? empty);
  const setLibrary = useCallback(
    (next: React.SetStateAction<ContentPage>) =>
      setLocal((previous) => {
        const value =
          previous?.key === queryKey && previous.source === query.data
            ? previous.value
            : (query.data ?? { items: [], total: 0, pages: 0, page: 1, pageSize: 25 });
        return {
          key: queryKey,
          source: query.data,
          value: typeof next === 'function' ? next(value) : next,
        };
      }),
    [queryKey, query.data],
  );
  useEffect(() => {
    if (query.error) setError(query.error);
  }, [query.error]);
  useEffect(() => {
    setBulkIds([]);
  }, [filter, libraryPage, libraryType, librarySort, fieldFilters, tab, status, visibility]);
  function receiveEntry(result: EntryRecord) {
    setLibrary((old) => ({
      ...old,
      items: old.items.map((item) =>
        item.id === result.id
          ? {
              ...item,
              revision: result.revision,
              updatedAt: result.updatedAt,
              hasChanges: true,
              value: {
                ...item.value,
                title: result.value.title,
                description: result.value.description,
                fields: result.value.fields,
              },
            }
          : item,
      ),
    }));
  }
  return {
    receiveEntry,
    libraryLoading: query.loading && query.data === undefined,
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
