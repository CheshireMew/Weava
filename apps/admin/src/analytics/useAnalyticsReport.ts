import { useEffect, useRef, useState } from 'react';

import type { AnalyticsReport, AnalyticsRealtime, GeoStatus } from '@weava/contracts';
import { api } from '../api.ts';
import { useAdminQuery } from '../useAdminQuery.ts';

import { shift, today } from './format.ts';
import { watchVisible } from './polling.ts';
import type {AnalyticsSection} from './report-navigation.ts';
export function useAnalyticsReport(initialQuery = '', realtime = true,section:AnalyticsSection|'all'='all') {
  const initial = new URLSearchParams(initialQuery);
  const [live, setLive] = useState<AnalyticsRealtime | null>(null),
    [geo, setGeo] = useState<GeoStatus | null>(null);
  const [start, setStart] = useState(initial.get('start') || ''),
    [end, setEnd] = useState(initial.get('end') || ''),
    [path, setPath] = useState(initial.get('path') || ''),
    [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries([...initial].filter(([key]) => ['channel', 'country', 'browser', 'os', 'device', 'model'].includes(key))));
  const [applied, setApplied] = useState(initialQuery),
    [geoBusy, setGeoBusy] = useState(false),
    [exportType, setExportType] = useState('pages');
  useEffect(()=>{
    const query=new URLSearchParams(initialQuery);setApplied(initialQuery);setStart(query.get('start')??'');setEnd(query.get('end')??'');setPath(query.get('path')??'');
    setFilters(Object.fromEntries([...query].filter(([key])=>['channel','country','browser','os','device','model'].includes(key))));
  },[initialQuery]);
  const [liveError, setLiveError] = useState(''),
    [geoError, setGeoError] = useState('');
  const retryLive = useRef<() => void>(() => {});
  const requestQuery=new URLSearchParams(applied);
  if(section!=='all')requestQuery.set('section',section);
  const report = useAdminQuery<AnalyticsReport>(`analytics?${requestQuery}`, 15000);
  const previous=useRef<{data:AnalyticsReport;query:string;section:string}|null>(null);
  if(report.data)previous.current={data:report.data,query:applied,section};
  const retained=previous.current?.section===section?previous.current:null;
  const data=report.data??retained?.data??null,stale=!report.data&&!!data;
  const loading=report.loading,error=report.error,loadedQuery=report.data?applied:retained?.query??'';
  const query = (changes: Record<string, string> = {}) =>
    new URLSearchParams({
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(path ? { path } : {}),
      ...filters,
      ...changes,
    }).toString();
  const load = async (q = applied) => {
    if (q !== applied) setApplied(q);
    else await report.refresh().catch(() => {});
  };
  useEffect(() => {
    if (report.data) {
      setLive(report.data.realtime);
      setLiveError('');
      setGeo(report.data.geo);
      setGeoError('');
      setStart(report.data.range.start);
      setEnd(report.data.range.end);
    }
  }, [report.data]);
  useEffect(() => {
    if (!realtime) return;
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
  }, [loadedQuery, realtime]);
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
    stale,
    refreshing: report.refreshing||stale&&!error,
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
