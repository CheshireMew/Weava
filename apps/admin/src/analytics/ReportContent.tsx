import { useContext } from 'react';
import type { AnalyticsReport } from '@weava/contracts';
import { Trend } from './Trend.tsx';
import { DataTable, type Column } from './DataTable.tsx';
import { Distribution } from './Distribution.tsx';
import { analyticsPresentation } from './presentation.tsx';
import { VisitorIdentity, CountryFlag, BrowserIcon, OsIcon, DeviceIcon } from './AnalyticsIcons.tsx';
import { channels, country, dateAt, duration } from './format.ts';
import { ReportWorkspace } from './report-workspace.ts';
import type { ReportName } from './report-navigation.ts';

export function TrafficChart({ data, detail = false }: { data: AnalyticsReport; detail?: boolean }) {
  return <Trend detail={detail} dates={data.daily.map(d => d.date)} empty={!data.views && !data.previous.views} series={[
    { name: '访客', color: 'var(--analytics-blue)', values: data.daily.map(d => d.visitors), total: data.visitors },
    { name: '浏览量', color: 'var(--analytics-purple)', values: data.daily.map(d => d.views), total: data.views },
    { name: '上期访客', group: '访客', color: 'var(--analytics-blue)', values: data.daily.map(d => d.previousVisitors), total: data.previous.visitors, dashed: true },
    { name: '上期浏览', group: '浏览量', color: 'var(--analytics-purple)', values: data.daily.map(d => d.previousViews), total: data.previous.views, dashed: true },
  ]} />;
}
export function SourcesChart({ data, detail = false }: { data: AnalyticsReport; detail?: boolean }) {
  const dates = data.daily.map(d => d.date);
  return <Trend detail={detail} dates={dates} empty={!data.engines.length} series={data.engines.flatMap((engine, i) => {
    const color = ['var(--analytics-green)', 'var(--analytics-blue)', 'var(--analytics-purple)', 'var(--analytics-cyan)', 'var(--analytics-orange)'][i % 5];
    return [
      { name: engine.name, color, total: engine.sessions, values: dates.map(date => engine.daily.find(d => d.date === date)?.sessions || 0) },
      { name: engine.name + ' 上期', group: engine.name, color, dashed: true, total: engine.previousSessions, values: dates.map(date => engine.previousDaily.find(d => d.date === date)?.sessions || 0) },
    ];
  })} />;
}
export function ReportContent({ report, data, query, detail = false }: { report: ReportName; data: AnalyticsReport; query: string; detail?: boolean }) {
  const workspace = useContext(ReportWorkspace)!;
  const openVisitor = (id: string) => workspace.openVisitor(id, data);
  const { pageLink, pageColumns } = analyticsPresentation(data, openVisitor);
  const filter = (key: string, value: string) => { const p = new URLSearchParams(query); p.set(key, value); workspace.navigate(report, p.toString()); };
  if (report === 'traffic') return <TrafficChart data={data} detail={detail} />;
  if (report === 'pages') return <DataTable preview={!detail} rows={data.pages} size={detail ? 25 : 6} columns={detail ? pageColumns : [pageColumns[0], pageColumns[1], pageColumns[2], pageColumns[5]]} />;
  if (['countries', 'browsers', 'os', 'devices', 'models'].includes(report)) {
    const rows = report === 'os' ? data.operatingSystems : data[report as 'countries' | 'browsers' | 'devices' | 'models'];
    const key = ({ countries: 'country', browsers: 'browser', os: 'os', devices: 'device', models: 'model' } as const)[report as 'countries' | 'browsers' | 'os' | 'devices' | 'models'];
    return <Distribution rows={rows} allRows={detail} controls={false} label={report === 'countries' ? country : report === 'devices' ? value => ({ desktop: '电脑', smartphone: '手机', tablet: '平板' }[value] || value) : undefined}
      icon={name => report === 'countries' ? <CountryFlag code={name} /> : report === 'browsers' ? <BrowserIcon name={name} /> : report === 'os' ? <OsIcon name={name} /> : <DeviceIcon name={name} />}
      onSelect={value => filter(key, value)} />;
  }
  if (report === 'sources') return <>
    {detail && <SourcesChart data={data} detail />}
    <DataTable preview={!detail} size={detail ? 25 : 6} rows={data.sources} columns={[
      { key: 'name', label: '来源', render: v => <span className="analytics-source" title={v.host || v.name}>{v.name}<small>{channels[v.channel] || v.channel}</small></span> },
      ...(detail ? [{ key: 'sessions', label: '会话', numeric: true }, { key: 'visitors', label: '访客', numeric: true }] : []),
      { key: 'views', label: '浏览', numeric: true },
    ]} />
  </>;
  const visitors = report === 'active' ? data.activeVisitors : data.recentVisitors;
  const columns: Column[] = [
    { key: 'lastSeen', label: '最后访问', render: v => <time className="analytics-time" dateTime={v.lastSeen} title={dateAt(v.lastSeen, data.range.timezone)}>{dateAt(v.lastSeen, data.range.timezone)}</time> },
    { key: 'id', label: '访客信息', render: v => <VisitorIdentity visitor={v} onOpen={openVisitor} /> },
    { key: 'source', label: '访问来源', render: v => <span className="analytics-source" title={v.source}>{v.source || '直接 / 未知'}<small>{channels[v.channel] || v.channel}</small></span> },
    { key: 'entryPath', label: '入口页面', render: v => pageLink(v.entryPath) },
    { key: 'exitPath', label: '最后页面', render: v => pageLink(v.exitPath) },
    { key: 'views', label: '浏览', numeric: true },
    { key: 'activeMs', label: '停留', numeric: true, render: v => duration(v.activeMs) },
  ];
  const selected = detail ? columns : report === 'active' ? [columns[5], columns[1], columns[2], columns[3], columns[4]] : [columns[0], columns[1], columns[2], columns[4], columns[5]];
  return <DataTable preview={!detail} size={detail ? 25 : 6} rows={visitors} columns={selected} />;
}
