import { useContext } from 'react';
import { AnalyticsActions } from './AnalyticsActions.tsx';
import { AnalyticsGeography } from './AnalyticsGeography.tsx';
import { ReportContent } from './ReportContent.tsx';
import { ReportWorkspace } from './report-workspace.ts';
import { reports, type ReportName } from './report-navigation.ts';
import { Card } from './Card.tsx';
import type { AnalyticsController } from './useAnalyticsReport.ts';
import { DataTable } from './DataTable.tsx';
import { VisitorIdentity } from './AnalyticsIcons.tsx';
import { analyticsPresentation } from './presentation.tsx';
import { dateAt } from './format.ts';
import { dateRange } from './date-ranges.ts';

export function AnalyticsDetail({ report, query, model, onError }: { report: ReportName; query: string; model: AnalyticsController; onError: (message: string) => void }) {
  const workspace = useContext(ReportWorkspace)!, data = model.data;
  if (!data) return null;
  const filter = (key: string, value: string) => { const p = new URLSearchParams(query); if (value) p.set(key, value); else p.delete(key); workspace.navigate(report, p.toString()); };
  const openVisitor = (id: string) => workspace.openVisitor(id, report === 'realtime' ? { ...data, range: { ...data.range, ...dateRange('today', data.range.timezone) } } : data);
  const view = { ...model, data, filter, openVisitor, onError };
  return <div className="analytics-detail">
    {report === 'actions' ? <div className="analytics-main"><AnalyticsActions model={view} /></div> : report === 'realtime' ? <Card title="当前在线" action={<span className="analytics-live-count"><i />{model.live?.count || 0}</span>}>
      {model.liveError && <p className="analytics-card-error" role="status">{model.liveError}<button onClick={() => model.retryLive.current()}>重试实时统计</button></p>}
      <DataTable rows={model.live?.visitors || []} empty="当前没有在线访客。" columns={[
        { key: 'lastSeen', label: '最后活动', render: row => dateAt(row.lastSeen, data.range.timezone) },
        { key: 'id', label: '访客信息', render: row => <VisitorIdentity visitor={row} onOpen={openVisitor} /> },
        { key: 'path', label: '当前页面', render: row => analyticsPresentation(data, openVisitor).pageLink(row.path) },
      ]} />
      <p className="analytics-note">最近 {model.live?.windowMinutes || 5} 分钟的在线访客，每 15 秒更新，不随历史日期和来源筛选改变。</p>
    </Card> : <Card title={reports[report].title} dateRange><ReportContent report={report} data={data} query={query} detail /></Card>}
    {report === 'countries' && <AnalyticsGeography model={view} />}
  </div>;
}
