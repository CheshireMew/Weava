import {TabList} from './TabList.tsx';
import {useEffect,useId,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import type {AnalyticsReport} from '@weava/contracts';
import {AnalyticsReportView} from './AnalyticsReportView.tsx';
import {useAnalyticsReport} from './analytics/useAnalyticsReport.ts';
import {ReportWorkspace,internalClick} from './analytics/report-workspace.ts';
import {reportLocation,reportSection,sections,reportUrl,type AnalyticsSection,type ReportName} from './analytics/report-navigation.ts';
import {AnalyticsDetail} from './analytics/AnalyticsDetail.tsx';
import {AnalyticsExportContext} from './analytics/Card.tsx';
import {VisitorDetails} from './analytics/VisitorDetails.tsx';
import {DateRangeMenu} from './analytics/DateRangeMenu.tsx';
import {dateRange} from './analytics/date-ranges.ts';
import './AnalyticsPanel.css';
import {LoadingState} from './LoadingState.tsx';
import {CollectionHealth} from './analytics/CollectionHealth.tsx';

type Location = ReturnType<typeof reportLocation>;
type WorkspaceProps = { route: Location; navigate: (report: ReportName | null, query?: string, section?: AnalyticsSection) => void; onError: (message: string) => void; timezone: string };
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
  return <AnalyticsWorkspace route={route} navigate={navigate} onError={onError} timezone={timezone} />;
}
function AnalyticsNavigation({route,navigate,id}:Pick<WorkspaceProps,'route'|'navigate'> & {id:string}) {
  return <div className="centered-section-tabs"><TabList className="library-status-tabs" label="统计报表" items={sections.map(([id,label])=>({id,label}))} selected={route.section} onSelect={key=>navigate(null,route.query,key)} idFor={key=>id+key} panelFor={()=>id+'panel'}/></div>;
}
function AnalyticsWorkspace({ route, navigate, onError, timezone }: WorkspaceProps) {
  const model = useAnalyticsReport(route.query,true,route.section);
  const [visitor, setVisitor] = useState<{ id: string; data: AnalyticsReport } | null>(null);
  const id = useId(), { data, loading, error } = model;
  const query = new URLSearchParams(route.query);
  if (data&&!model.stale) { query.set('start', data.range.start); query.set('end', data.range.end); }
  const appliedQuery = query.toString();
  const defaults = dateRange('30', timezone);
  const range = { start: query.get('start') || defaults.start, end: query.get('end') || defaults.end };
  const changeQuery = (query: string) => navigate(route.report, query, route.section);
  const changeRange = (start: string, end: string) => { const next = new URLSearchParams(appliedQuery); next.set('start', start); next.set('end', end); changeQuery(next.toString()); };
  return <div className="panel analytics-panel">
    <header className="panel-title"><h1>访问统计</h1><div className="analytics-header-actions"><button disabled={loading || model.refreshing} onClick={() => model.load()} aria-label="刷新统计"><RefreshCw size={16} className={loading || model.refreshing ? 'spin' : ''} />刷新</button></div></header>
    <AnalyticsNavigation route={route} navigate={navigate} id={id}/>
    <CollectionHealth/>
    <section id={id + 'panel'} role="tabpanel" aria-labelledby={id + route.section} aria-busy={loading}>
      {error && <div className="analytics-error" role="alert"><span>{error}</span><div className="analytics-error-actions"><button onClick={() => model.load()}>重试</button></div></div>}
      {!data && loading && <LoadingState label="读取统计" />}
      {!data && route.report!=='realtime' && <footer className="analytics-card-footer"><DateRangeMenu label="统计" {...range} timezone={timezone} disabled={loading} onChange={changeRange}/></footer>}
      {data && <ReportWorkspace.Provider value={{ data, query: model.stale?model.loadedQuery:appliedQuery, loading, range:{...range,timezone:data.range.timezone||timezone}, changeRange, navigate, openVisitor: (id, data) => setVisitor({ id, data }) }}>
        <AnalyticsExportContext.Provider value={!loading&&!model.stale ? appliedQuery : null}>
          {route.report ? <>
            <div className="analytics-report-heading"><a href={reportUrl(null, appliedQuery, route.section)} onClick={event => internalClick(event, () => navigate(null, appliedQuery, route.section))}><ArrowLeft size={14} />返回{sections.find(([key]) => key === route.section)?.[1]}</a></div>
            <AnalyticsExportContext.Provider value={!loading&&!model.stale?appliedQuery:null}><AnalyticsDetail report={route.report} query={appliedQuery} model={model} onError={onError} /></AnalyticsExportContext.Provider>
          </> : <AnalyticsReportView data={data} model={model} section={route.section} onError={onError} />}
        </AnalyticsExportContext.Provider>
        {visitor && <VisitorDetails key={visitor.id} visitor={visitor.id} setVisitor={() => setVisitor(null)} data={visitor.data} />}
      </ReportWorkspace.Provider>}
    </section>
  </div>;
}
