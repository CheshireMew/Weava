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

function SourceLabel({ name, channel, host }: { name?: string; channel: string; host?: string | null }) {
  if (channel === 'direct-or-unknown' && (!name || name === '直接 / 未知')) {
    return <span className="analytics-source">未记录来源<small>直接打开或来源未传递</small></span>;
  }
  return <span className="analytics-source" title={host || name}>{name || '未记录来源'}<small>{channels[channel] || channel}</small></span>;
}

export function TrafficChart({ data }: { data: AnalyticsReport }) {
  return <Trend dates={data.daily.map(d => d.date)} empty={!data.views} series={[
    { name: '访客', color: 'var(--analytics-blue)', values: data.daily.map(d => d.visitors), total: data.visitors },
    { name: '浏览量', color: 'var(--analytics-purple)', values: data.daily.map(d => d.views), total: data.views },
  ]} />;
}
export function SourcesChart({ data }: { data: AnalyticsReport }) {
  const dates = data.daily.map(d => d.date);
  const engines=[...data.engines].sort((a,b)=>b.views-a.views||a.name.localeCompare(b.name));
  return <Trend defaultVisible={2} dates={dates} empty={!engines.some(engine=>engine.views>0)} series={engines.map((engine,i)=>({
    name:engine.name,color:['var(--analytics-blue)','var(--analytics-green)','var(--analytics-purple)','var(--analytics-orange)','var(--analytics-cyan)'][i%5],
    total:engine.views,values:dates.map(date=>engine.daily.find(day=>day.date===date)?.views||0),
  }))}/>;
}
export function ReportContent({ report, data, query, detail = false, tableOnly = false }: { report: ReportName; data: AnalyticsReport; query: string; detail?: boolean; tableOnly?: boolean }) {
  const workspace = useContext(ReportWorkspace)!;
  const openVisitor = (id: string) => workspace.openVisitor(id, data);
  const { pageLink, pageColumns } = analyticsPresentation(data, openVisitor);
  if (report === 'traffic') return <TrafficChart data={data} />;
  if (report === 'pages') return <DataTable preview={!detail} rows={data.pages} size={detail ? 25 : 6} columns={detail ? pageColumns : [pageColumns[0], pageColumns[1], pageColumns[2], pageColumns[5]]} />;
  if (['countries', 'browsers', 'os', 'devices', 'models'].includes(report)) {
    const rows = report === 'os' ? data.operatingSystems : data[report as 'countries' | 'browsers' | 'devices' | 'models'];
    return <Distribution rows={rows} allRows={detail} controls={false} label={report === 'countries' ? country : report === 'devices' ? value => ({ desktop: '电脑', smartphone: '手机', tablet: '平板' }[value] || value) : undefined}
      icon={name => report === 'countries' ? <CountryFlag code={name} /> : report === 'browsers' ? <BrowserIcon name={name} /> : report === 'os' ? <OsIcon name={name} /> : <DeviceIcon name={name} />} />;
  }
  if (report === 'sources') return <>
    {detail && !tableOnly && <SourcesChart data={data} />}
    <DataTable preview={!detail} size={5} resetKey={query} rows={data.sources} empty="所选日期内没有可识别的访问来源。" columns={[
      { key: 'name', label: '来源', render: v => <SourceLabel name={v.name} channel={v.channel} host={v.host} /> },
      ...(detail ? [{ key: 'sessions', label: '会话', numeric: true }, { key: 'visitors', label: '访客', numeric: true }] : []),
      { key: 'views', label: '浏览', numeric: true },
    ]} />
  </>;
  const visitors = report === 'active' ? data.activeVisitors : data.recentVisitors;
  const columns: Column[] = [
    { key: 'lastSeen', label: '最后访问', render: v => <time className="analytics-time" dateTime={v.lastSeen} title={dateAt(v.lastSeen, data.range.timezone)}>{dateAt(v.lastSeen, data.range.timezone)}</time> },
    { key: 'id', label: '访客信息', render: v => <VisitorIdentity visitor={v} onOpen={openVisitor} /> },
    { key: 'source', label: '访问来源', render: v => <SourceLabel name={v.source} channel={v.channel} /> },
    { key: 'entryPath', label: '入口页面', render: v => pageLink(v.entryPath) },
    { key: 'exitPath', label: '最后页面', render: v => pageLink(v.exitPath) },
    { key: 'views', label: '浏览', numeric: true },
    { key: 'activeMs', label: '停留', numeric: true, render: v => duration(v.activeMs) },
  ];
  const selected = detail ? columns : report === 'active' ? [columns[5], columns[1], columns[2], columns[3], columns[4]] : [columns[0], columns[1], columns[2], columns[4], columns[5]];
  return <DataTable preview={!detail} size={detail ? 25 : 6} rows={visitors} columns={selected} />;
}
