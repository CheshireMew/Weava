import { useContext } from 'react';
import { AnalyticsExportContext } from './Card.tsx';
import { AnalyticsControls } from './AnalyticsControls.tsx';
import { AnalyticsActions } from './AnalyticsActions.tsx';
import { AnalyticsGeography } from './AnalyticsGeography.tsx';
import { ReportContent } from './ReportContent.tsx';
import { ReportWorkspace } from './report-workspace.ts';
import { reports, type ReportName } from './report-navigation.ts';
import { useAnalyticsReport } from './useAnalyticsReport.ts';
import { DataTable } from './DataTable.tsx';
import { VisitorIdentity } from './AnalyticsIcons.tsx';
import { analyticsPresentation } from './presentation.tsx';
import { dateAt } from './format.ts';
import { dateRange } from './date-ranges.ts';

export function AnalyticsDetail({ report, query, onError }: { report: ReportName; query: string; onError: (message: string) => void }) {
  const workspace = useContext(ReportWorkspace)!;
  const model = useAnalyticsReport(query, report === 'realtime');
  const data = model.data;
  const filter = (key: string, value: string) => {
    const p = new URLSearchParams(query); if (value) p.set(key, value); else p.delete(key);
    workspace.navigate(report, p.toString());
  };
  const openVisitor = (id: string) => { if (data) workspace.openVisitor(id, report === 'realtime' ? { ...data, range: { ...data.range, ...dateRange('today', data.range.timezone) } } : data); };
  const loadedQuery = new URLSearchParams(model.loadedQuery);
  if (data) { loadedQuery.set('start', data.range.start); loadedQuery.set('end', data.range.end); }
  const view = data && { ...model, data, filter, openVisitor, onError };
  return <div className="analytics-detail" aria-busy={model.loading}>
    <AnalyticsControls model={model} report={report} query={query} />
    {model.error && <p className="analytics-error" role="alert">{model.error}<button onClick={() => model.load()}>重试</button></p>}
    {!data && model.loading && <p className="analytics-loading" role="status">正在读取报表…</p>}
    {data && !model.error && <AnalyticsExportContext.Provider value={loadedQuery.toString()}>
      {report === 'actions' && view ? <div className="analytics-main"><AnalyticsActions model={view} /></div> : report === 'realtime' ? <section className="analytics-card">
        <header className="analytics-card-title"><h2>当前在线 <span className="analytics-live-count"><i />{model.live?.count || 0}</span></h2><span>{model.live && dateAt(model.live.at, data.range.timezone)} 更新</span></header>
        {model.liveError && <p className="analytics-card-error" role="status">{model.liveError}<button onClick={() => model.retryLive.current()}>重试实时统计</button></p>}
        <DataTable rows={model.live?.visitors || []} empty="当前没有在线访客。" columns={[
          { key: 'lastSeen', label: '最后活动', render: row => dateAt(row.lastSeen, data.range.timezone) },
          { key: 'id', label: '访客信息', render: row => <VisitorIdentity visitor={row} onOpen={openVisitor} /> },
          { key: 'path', label: '当前页面', render: row => analyticsPresentation(data, openVisitor).pageLink(row.path) },
        ]} />
      </section> : <section className="analytics-card"><header className="analytics-card-title"><h2>{reports[report].title}</h2></header><ReportContent report={report} data={data} query={loadedQuery.toString()} detail /></section>}
      {report === 'countries' && view && <AnalyticsGeography model={view} />}
      {report !== 'realtime' && <p className="analytics-comparison">{data.range.start} — {data.range.end}<span>对比 {data.range.previousStart} — {data.range.previousEnd} · {data.range.timezone}</span></p>}
    </AnalyticsExportContext.Provider>}
  </div>;
}
