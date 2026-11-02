import { useEffect, useRef, useState } from 'react';

import type { AnalyticsReport, AnalyticsRealtime, GeoStatus } from '@weava/contracts';
import { api } from '../api.ts';

import { shift, today } from './format.ts';
import { watchVisible } from './polling.ts';
export function useAnalyticsReport() {
  const [data, setData] = useState<AnalyticsReport | null>(null),
    [live, setLive] = useState<AnalyticsRealtime | null>(null),
    [geo, setGeo] = useState<GeoStatus | null>(null);
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [path, setPath] = useState(''),
    [filters, setFilters] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState(''),
    [loadedQuery, setLoadedQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [geoBusy, setGeoBusy] = useState(false),
    [exportType, setExportType] = useState('pages');
  const [liveError, setLiveError] = useState(''),
    [geoError, setGeoError] = useState('');
  const retryLive = useRef<() => void>(() => {});
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = (changes: Record<string, string> = {}) =>
    new URLSearchParams({
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(path ? { path } : {}),
      ...filters,
      ...changes,
    }).toString();
  const load = async (q = applied) => {
    const g = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await api(`analytics?${q}`);
      if (!mounted.current || g !== generation.current) return;
      setData(result);
      setLoadedQuery(q);
      setLive(result.realtime);
      setLiveError('');
      setGeo(result.geo);
      setGeoError('');
      if (!q) {
        setStart(result.range.start);
        setEnd(result.range.end);
      }
    } catch (e: any) {
      if (mounted.current && g === generation.current) setError(e.message);
    } finally {
      if (mounted.current && g === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(applied);
  }, [applied]);
  useEffect(() => {
    const p = new URLSearchParams(loadedQuery);
    const watch = watchVisible<AnalyticsRealtime>(
      () =>
        api(
          `analytics/realtime?${p.get('path') ? 'path=' + encodeURIComponent(p.get('path')!) : ''}`,
        ),
      (next) => {
        setLive(next);
        setLiveError('');
      },
      setLiveError,
      15000,
    );
    retryLive.current = () => {
      void watch.refresh();
    };
    return watch.stop;
  }, [loadedQuery]);
  useEffect(() => {
    if (!geo?.updating) return;
    const watch = watchVisible<GeoStatus>(
      () => api('analytics/geo'),
      (state) => {
        setGeo(state);
        setGeoError('');
      },
      setGeoError,
      2000,
    );
    return watch.stop;
  }, [geo?.updating]);
  const apply = (nextFilters = filters) => {
    const q = query(nextFilters);
    if (q === applied) void load(q);
    else setApplied(q);
  };
  const filter = (key: string, value: string) => {
    const next = { ...filters };
    if (!value) delete next[key];
    else next[key] = value;
    setFilters(next);
    const q = new URLSearchParams({
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(path ? { path } : {}),
      ...next,
    }).toString();
    if (q === applied) void load(q);
    else setApplied(q);
  };
  const preset = (days: number, offset = 0) => {
    const last = shift(today(data?.range.timezone), offset),
      first = shift(last, 1 - days);
    setStart(first);
    setEnd(last);
    setApplied(
      new URLSearchParams({
        start: first,
        end: last,
        ...(path ? { path } : {}),
        ...filters,
      }).toString(),
    );
  };
  const updateGeo = async () => {
    setGeoBusy(true);
    try {
      setGeo(await api('analytics/geo', {}));
      setGeoError('');
    } catch (e: any) {
      setGeoError(e.message);
    } finally {
      setGeoBusy(false);
    }
  };
  return {
    data,
    live,
    geo,
    start,
    end,
    path,
    filters,
    applied,
    loadedQuery,
    loading,
    error,
    geoBusy,
    exportType,
    liveError,
    geoError,
    retryLive,
    setStart,
    setEnd,
    setPath,
    setFilters,
    setApplied,
    setExportType,
    load,
    apply,
    filter,
    preset,
    updateGeo,
  };
}
export type AnalyticsController = ReturnType<typeof useAnalyticsReport>;
