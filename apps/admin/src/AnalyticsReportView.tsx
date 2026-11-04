import { useContext, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AnalyticsReport } from '@weava/contracts';
import { Card } from './analytics/Card.tsx';
import { ReportCard } from './analytics/ReportCard.tsx';
import { ReportWorkspace, reportQuery, internalClick } from './analytics/report-workspace.ts';
import { ReportContent, SourcesChart } from './analytics/ReportContent.tsx';
import { WorldMap } from './analytics/WorldMap.tsx';
import { DataTable } from './analytics/DataTable.tsx';
import { VisitorIdentity } from './analytics/AnalyticsIcons.tsx';
import { number, duration, change, dateAt } from './analytics/format.ts';
import { reportUrl } from './analytics/report-navigation.ts';
import { dateRange } from './analytics/date-ranges.ts';
import { analyticsPresentation } from './analytics/presentation.tsx';
import type { AnalyticsController } from './analytics/useAnalyticsReport.ts';

export function Delta({ now, before }: { now: number; before: number }) {
  return <small className={'analytics-delta ' + (now > before ? 'positive' : now < before ? 'negative' : 'neutral')}>{change(now, before)}</small>;
}
export function AnalyticsReportView({ data, model, onError }: { data: AnalyticsReport; model: AnalyticsController; onError: (message: string) => void }) {
  const workspace = useContext(ReportWorkspace)!;
  const [excluded, setExcluded] = useState(() => localStorage.getItem('weava-exclude') === '1');
  const query = reportQuery(data), live = model.live;
  const { pageLink } = analyticsPresentation(data, () => {});
  const openLiveVisitor = (id: string) => workspace.openVisitor(id, { ...data, range: { ...data.range, ...dateRange('today', data.range.timezone) } });
  return <div className="analytics-dashboard">
    <aside className="analytics-sidebar" aria-label="流量概览与访客分布">
      <Card title="流量概览">
        <a className="analytics-online-summary" href={reportUrl('realtime', query)} onClick={event => internalClick(event, () => workspace.navigate('realtime', query))}>
          <span><i />当前在线</span><strong>{number(live?.count || 0)}<ArrowRight size={13} /></strong>
        </a>
        <table className="analytics-overview"><thead><tr><th>时间</th><th>访客</th><th>浏览</th></tr></thead><tbody>
          {data.overview.map(row => <tr key={row.name}><td><a href={reportUrl('traffic', new URLSearchParams({ start: row.start, end: row.end }).toString())} onClick={event => internalClick(event, () => workspace.navigate('traffic', new URLSearchParams({ start: row.start, end: row.end }).toString()))}>{row.name}</a></td>
            <td>{number(row.visitors)}<Delta now={row.visitors} before={row.previous.visitors} /></td><td>{number(row.views)}<Delta now={row.views} before={row.previous.views} /></td></tr>)}
          <tr><td>累计记录</td><td>{number(data.lifetime.visitors)}</td><td>{number(data.lifetime.views)}</td></tr>
        </tbody></table>
        <div className="analytics-overview-secondary" title={data.range.start + ' — ' + data.range.end}>
          <span>会话<strong>{number(data.sessions)}</strong></span><span>链接点击<strong>{number(data.clicks)}</strong></span><span>平均停留<strong>{duration(data.averageActiveMs)}</strong></span>
        </div>
      </Card>
      <ReportCard id="source-ranking" report="sources" title="来源排行">{(data, query) => <ReportContent report="sources" data={data} query={query} />}</ReportCard>
      {(['countries', 'browsers', 'os', 'devices', 'models'] as const).map(report => <ReportCard key={report} id={report} report={report}>{(data, query) => <ReportContent report={report} data={data} query={query} />}</ReportCard>)}
      <div className="analytics-local-options"><label><input type="checkbox" checked={excluded} onChange={event => {
        try { localStorage.setItem('weava-exclude', event.target.checked ? '1' : '0'); setExcluded(event.target.checked); } catch { onError('浏览器不允许保存排除设置。'); }
      }} />排除本机后续访问</label></div>
    </aside>
    <div className="analytics-main" aria-label="趋势与访问明细">
      {(data.engines.length ? ['search', 'traffic'] : ['traffic', 'search']).map(kind => kind === 'search'
        ? <ReportCard key="search" id="search-trend" report="sources" title="搜索与 AI 来源趋势">{data => <SourcesChart data={data} />}</ReportCard>
        : <ReportCard key="traffic" id="traffic" report="traffic">{(data, query) => <ReportContent report="traffic" data={data} query={query} />}</ReportCard>)}
      <ReportCard id="pages" report="pages">{(data, query) => <ReportContent report="pages" data={data} query={query} />}</ReportCard>
      <ReportCard id="active" report="active">{(data, query) => <ReportContent report="active" data={data} query={query} />}</ReportCard>
      <ReportCard id="visitors" report="visitors">{(data, query) => <ReportContent report="visitors" data={data} query={query} />}</ReportCard>
      <section className="analytics-card" aria-label="当前在线"><header className="analytics-card-title"><h2>当前在线 <span className="analytics-live-count"><i />{live?.count || 0}</span></h2></header>
        {model.liveError && <p className="analytics-card-error" role="status">{model.liveError}<button onClick={() => model.retryLive.current()}>重试</button></p>}
        <DataTable preview rows={live?.visitors || []} size={6} empty="当前没有在线访客。" columns={[
          { key: 'lastSeen', label: '最后活动', render: row => <time className="analytics-time" dateTime={row.lastSeen}>{dateAt(row.lastSeen, data.range.timezone)}</time> },
          { key: 'id', label: '访客信息', render: row => <VisitorIdentity visitor={row} onOpen={openLiveVisitor} /> },
          { key: 'path', label: '当前页面', render: row => pageLink(row.path) },
        ]} />
        <footer className="analytics-card-footer"><span>最近 {live?.windowMinutes || 5} 分钟 · 每 15 秒更新</span><a href={reportUrl('realtime', query)} onClick={event => internalClick(event, () => workspace.navigate('realtime', query))}>查看在线访客<ArrowRight size={13} /></a></footer>
      </section>
      <ReportCard id="world" report="countries" title="全球访客分布">{(data, query) => <WorldMap rows={data.countries} onSelect={country => { const p = new URLSearchParams(query); p.set('country', country); workspace.navigate('countries', p.toString()); }} />}</ReportCard>
    </div>
  </div>;
}
