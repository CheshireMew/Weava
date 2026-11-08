import {TabList} from './TabList.tsx';
import {useEffect,useId,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import type {AnalyticsReport} from '@weava/contracts';
import {AnalyticsReportView} from './AnalyticsReportView.tsx';
import {AnalyticsControls,AnalyticsFilterTags} from './analytics/AnalyticsControls.tsx';
import {useAnalyticsReport} from './analytics/useAnalyticsReport.ts';
import {ReportWorkspace,internalClick} from './analytics/report-workspace.ts';
import {reportLocation,reportSection,sections,reportUrl,type AnalyticsSection,type ReportName} from './analytics/report-navigation.ts';
import {AnalyticsDetail} from './analytics/AnalyticsDetail.tsx';
import {AnalyticsExportContext} from './analytics/Card.tsx';
import {VisitorDetails} from './analytics/VisitorDetails.tsx';
import {DateRangeMenu} from './analytics/DateRangeMenu.tsx';
import './AnalyticsPanel.css';
import {LoadingState} from './LoadingState.tsx';

type Location = ReturnType<typeof reportLocation>;
export default function AnalyticsPanel({ onError, timezone = 'Asia/Shanghai' }: { onError: (message: string) => void; timezone?: string }) {
  const [route, setRoute] = useState(() => reportLocation(window.location.search));
  useEffect(() => {
    const back = () => setRoute(reportLocation(window.location.search));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const navigate = (report: ReportName | null, query = route.query, section: AnalyticsSection = report ? reportSection(report) : route.section) => {
    window.history.pushState(null, '', reportUrl(report, query, section));
    setRoute({ report, query, section });
    document.querySelector('.analytics-panel')?.scrollTo({ top: 0 });
  };
  return <AnalyticsWorkspace key={route.query} route={route} navigate={navigate} onError={onError} timezone={timezone} />;
}
function AnalyticsWorkspace({ route, navigate, onError, timezone }: { route: Location; navigate: (report: ReportName | null, query?: string, section?: AnalyticsSection) => void; onError: (message: string) => void; timezone: string }) {
  const model = useAnalyticsReport(route.query,true,route.section);
  const [visitor, setVisitor] = useState<{ id: string; data: AnalyticsReport } | null>(null);
  const id = useId(), { data, loading, error } = model;
  const query = new URLSearchParams(route.query);
  if (data) { query.set('start', data.range.start); query.set('end', data.range.end); }
  const appliedQuery = query.toString();
  const changeQuery = (query: string) => navigate(route.report, query, route.section);
  const changeRange = (start: string, end: string) => { const next = new URLSearchParams(appliedQuery); next.set('start', start); next.set('end', end); changeQuery(next.toString()); };
  const tabs = <div className="analytics-section-navigation"><TabList className="library-status-tabs analytics-tabs" label="统计报表" items={sections.map(([id,label])=>({id,label}))} selected={route.section} onSelect={key=>navigate(null,route.query,key)} idFor={key=>id+key} panelFor={()=>id+'panel'}/></div>;
  return <div className="panel analytics-panel">
    <header className="panel-title"><h1>访问统计</h1><div className="analytics-header-actions"><AnalyticsControls model={model} report={route.report} query={appliedQuery} onChange={changeQuery} /><button disabled={loading || model.refreshing} onClick={() => model.load()} aria-label="刷新统计"><RefreshCw size={16} className={loading || model.refreshing ? 'spin' : ''} />刷新</button></div></header>
    {tabs}
    <AnalyticsFilterTags query={appliedQuery} onChange={changeQuery} />
    <section id={id + 'panel'} role="tabpanel" aria-labelledby={id + route.section} aria-busy={loading}>
      {error && <div className="analytics-error" role="alert"><span>{error}</span><div className="analytics-error-actions">{model.start && model.end && <DateRangeMenu label="统计" start={model.start} end={model.end} timezone={timezone} onChange={changeRange} />}<button onClick={() => model.load()}>重试</button></div></div>}
      {!data && loading && <LoadingState label="读取统计" />}
      {data && !error && <ReportWorkspace.Provider value={{ data, query: appliedQuery, loading, changeRange, navigate, openVisitor: (id, data) => setVisitor({ id, data }) }}>
        <AnalyticsExportContext.Provider value={!loading ? appliedQuery : null}>
          {route.report ? <>
            <div className="analytics-report-heading"><a href={reportUrl(null, appliedQuery, route.section)} onClick={event => internalClick(event, () => navigate(null, appliedQuery, route.section))}><ArrowLeft size={14} />返回{sections.find(([key]) => key === route.section)?.[1]}</a></div>
            <AnalyticsExportContext.Provider value={route.report === 'actions' ? appliedQuery : null}><AnalyticsDetail report={route.report} query={appliedQuery} model={model} onError={onError} /></AnalyticsExportContext.Provider>
          </> : <AnalyticsReportView data={data} model={model} section={route.section} onError={onError} />}
        </AnalyticsExportContext.Provider>
        {visitor && <VisitorDetails key={visitor.id} visitor={visitor.id} setVisitor={() => setVisitor(null)} data={visitor.data} />}
      </ReportWorkspace.Provider>}
    </section>
  </div>;
}
