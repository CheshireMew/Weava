import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { AnalyticsReport } from '@weava/contracts';
import { api } from './api.ts';
import { AnalyticsReportView } from './AnalyticsReportView.tsx';
import { useAnalyticsReport } from './analytics/useAnalyticsReport.ts';
import { ReportWorkspace, internalClick } from './analytics/report-workspace.ts';
import { reportLocation, reports, reportUrl, type ReportName } from './analytics/report-navigation.ts';
import { AnalyticsDetail } from './analytics/AnalyticsDetail.tsx';
import { VisitorDetails } from './analytics/VisitorDetails.tsx';
import './AnalyticsPanel.css';

export default function AnalyticsPanel({ onError }: { onError: (message: string) => void }) {
  const [route, setRoute] = useState(() => reportLocation(window.location.search));
  const model = useAnalyticsReport('', !route.report);
  const [ranges, setRanges] = useState<Record<string, string>>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('weava-analytics-ranges') || '{}');
      const allowed = [...Object.keys(reports), 'source-ranking', 'search-trend', 'world'];
      return Object.fromEntries(Object.entries(stored).filter(([key, query]) => {
        if (!allowed.includes(key) || typeof query !== 'string') return false;
        const p = new URLSearchParams(query), start = p.get('start') || '', end = p.get('end') || '';
        return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
      })) as Record<string, string>;
    } catch { return {}; }
  }), [refresh, setRefresh] = useState(0);
  useEffect(() => { try { sessionStorage.setItem('weava-analytics-ranges', JSON.stringify(ranges)); } catch {} }, [ranges]);
  const cache = useRef(new Map<string, Promise<AnalyticsReport>>());
  const [visitor, setVisitor] = useState<{ id: string; data: AnalyticsReport } | null>(null);
  const fetch = useCallback((query: string) => {
    const existing = cache.current.get(query);
    if (existing) return existing;
    const request = api(`analytics?${query}`).catch(error => { if (cache.current.get(query) === request) cache.current.delete(query); throw error; });
    if (cache.current.size >= 32) cache.current.delete(cache.current.keys().next().value!);
    cache.current.set(query, request);
    return request;
  }, []);
  const navigate = useCallback((report: ReportName | null, query = '') => {
    window.history.pushState(null, '', reportUrl(report, query));
    setRoute({ report, query }); setVisitor(null);
    document.querySelector('.analytics-panel')?.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const back = () => { setRoute(reportLocation(window.location.search)); setVisitor(null); };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const refreshAll = () => { cache.current.clear(); setRefresh(value => value + 1); void model.load(); };
  return <div className="panel analytics-panel">
    <header className="panel-title analytics-page-heading">
      <div>{route.report && <a className="analytics-back" href={reportUrl(null)} onClick={event => internalClick(event, () => navigate(null))}><ArrowLeft size={14} />访问统计</a>}<h1>{route.report ? reports[route.report].title : '访问统计'}</h1></div>
      {!route.report && <div className="analytics-actions"><a href={reportUrl('actions')} onClick={event => internalClick(event, () => navigate('actions'))}>链接与行为<ArrowLeft className="analytics-forward" size={13} /></a><button disabled={model.loading} onClick={refreshAll} aria-label="刷新统计"><RefreshCw size={15} className={model.loading ? 'spin' : ''} />刷新</button></div>}
    </header>
    {!model.data && model.loading && <p role="status" className="analytics-loading">正在读取统计…</p>}
    {!model.data && model.error && <p role="alert" className="analytics-error">{model.error}<button onClick={() => model.load()}>重试</button></p>}
    {model.data && <ReportWorkspace.Provider value={{ data: model.data, ranges, refresh, setRange: (id, query) => setRanges(old => ({ ...old, [id]: query })), fetch, navigate, openVisitor: (id, data) => setVisitor({ id, data }) }}>
      {route.report ? <AnalyticsDetail key={route.report + '?' + route.query} report={route.report} query={route.query} onError={onError} /> : <>
        {model.error && <p className="analytics-error" role="alert">{model.error}<button onClick={refreshAll}>重试</button></p>}
        <AnalyticsReportView data={model.data} model={model} onError={onError} />
      </>}
      {visitor && <VisitorDetails key={visitor.id} visitor={visitor.id} setVisitor={() => setVisitor(null)} data={visitor.data} />}
    </ReportWorkspace.Provider>}
  </div>;
}
