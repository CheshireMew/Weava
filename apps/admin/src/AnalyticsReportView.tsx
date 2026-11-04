import { useContext, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AnalyticsReport } from '@weava/contracts';
import { Card } from './analytics/Card.tsx';
import { ReportCard } from './analytics/ReportCard.tsx';
import { ReportWorkspace, internalClick } from './analytics/report-workspace.ts';
import { ReportContent, SourcesChart } from './analytics/ReportContent.tsx';
import { AnalyticsGeography } from './analytics/AnalyticsGeography.tsx';
import { AnalyticsActions } from './analytics/AnalyticsActions.tsx';
import { AnalyticsDetail } from './analytics/AnalyticsDetail.tsx';
import { number, change } from './analytics/format.ts';
import { reportUrl, type AnalyticsSection } from './analytics/report-navigation.ts';
import type { AnalyticsController } from './analytics/useAnalyticsReport.ts';

export function Delta({ now, before }: { now: number; before: number }) {
  return <span className={'analytics-delta ' + (now > before ? 'positive' : now < before ? 'negative' : 'neutral')}>{change(now, before)}</span>;
}
export function AnalyticsReportView({ data, model, section = 'overview', onError }: { data: AnalyticsReport; model: AnalyticsController; section?: AnalyticsSection; onError: (message: string) => void }) {
  const workspace = useContext(ReportWorkspace)!, query = workspace.query;
  const [visitorOrder, setVisitorOrder] = useState<'visitors' | 'active'>('visitors');
  const filter = (key: string, value: string) => { const p = new URLSearchParams(query); if (value) p.set(key, value); else p.delete(key); workspace.navigate(key === 'country' ? 'countries' : 'devices', p.toString()); };
  const view = { ...model, data, filter, openVisitor: (id: string) => workspace.openVisitor(id, data), onError };
  return <>
    {section === 'overview' && <>
      <Card title="搜索与 AI 来源趋势" dateRange><SourcesChart data={data} detail /></Card>
      <div className="analytics-dashboard">
        <ReportCard report="traffic">{(data, query) => <ReportContent report="traffic" data={data} query={query} />}</ReportCard>
        <aside className="analytics-sidebar"><Card title="流量概览">
          <a className="analytics-online-summary" href={reportUrl('realtime', query)} onClick={event => internalClick(event, () => workspace.navigate('realtime', query))}><span><i />当前在线</span><strong>{number(model.live?.count || 0)}<ArrowRight size={13} /></strong></a>
          <table className="analytics-overview"><thead><tr><th>时间</th><th>访客</th><th>浏览</th></tr></thead><tbody>
            {data.overview.map(row => <tr key={row.name}><td>{row.name}</td><td>{number(row.visitors)}<Delta now={row.visitors} before={row.previous.visitors} /></td><td>{number(row.views)}<Delta now={row.views} before={row.previous.views} /></td></tr>)}
            <tr><td>累计记录</td><td>{number(data.lifetime.visitors)}</td><td>{number(data.lifetime.views)}</td></tr>
          </tbody></table>
        </Card></aside>
      </div>
      <ReportCard report="pages">{(data, query) => <ReportContent report="pages" data={data} query={query} />}</ReportCard>
    </>}
    {section === 'sources' && <div className="analytics-main">
      <Card title="访问来源" dateRange><ReportContent report="sources" data={data} query={query} detail tableOnly /></Card>
      <div className="analytics-geography-grid"><AnalyticsGeography model={view} /><Card title="国家 / 地区" dateRange><ReportContent report="countries" data={data} query={query} /></Card></div>
    </div>}
    {section === 'visitors' && <div className="analytics-main">
      <Card title={visitorOrder === 'visitors' ? '最新访客' : '最活跃访客'} dateRange action={<select className="analytics-visitor-order" aria-label="访客排序" value={visitorOrder} onChange={event => setVisitorOrder(event.target.value as 'visitors' | 'active')}><option value="visitors">最新访问</option><option value="active">最活跃</option></select>}><ReportContent report={visitorOrder} data={data} query={query} detail /></Card>
      <AnalyticsDetail report="realtime" model={model} query={query} onError={onError} />
    </div>}
    {section === 'devices' && <div className="analytics-section-grid">{(['browsers', 'os', 'devices', 'models'] as const).map(report => <ReportCard key={report} report={report}>{(data, query) => <ReportContent report={report} data={data} query={query} />}</ReportCard>)}</div>}
    {section === 'actions' && <div className="analytics-main"><AnalyticsActions model={view} /></div>}
  </>;
}
