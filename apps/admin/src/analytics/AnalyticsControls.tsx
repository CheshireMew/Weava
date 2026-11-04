import { useContext } from 'react';
import { Download, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { Popover } from '../Popover.tsx';
import { channels, country, devices } from './format.ts';
import { DateRangeMenu } from './DateRangeMenu.tsx';
import { ReportWorkspace } from './report-workspace.ts';
import { reports, filterKeys, type ReportName } from './report-navigation.ts';
import type { AnalyticsController } from './useAnalyticsReport.ts';

export function AnalyticsControls({ model, report, query }: { model: AnalyticsController; report: ReportName; query: string }) {
  const workspace = useContext(ReportWorkspace)!;
  const { data, loading } = model;
  const params = new URLSearchParams(query);
  const filters = [...params].filter(([key]) => [...filterKeys, 'path'].includes(key));
  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value); else next.delete(key);
    workspace.navigate(report, next.toString());
  };
  const dimensionNames: Record<string, string> = { country: '国家 / 地区', browser: '浏览器', os: '操作系统', device: '设备类型', model: '设备型号', path: '页面', channel: '来源' };
  const dimensions = data ? [['country', data.countries], ['browser', data.browsers], ['os', data.operatingSystems], ['device', data.devices], ['model', data.models]] as const : [];
  const exportQuery = new URLSearchParams(query);
  if (data) { exportQuery.set('start', data.range.start); exportQuery.set('end', data.range.end); }
  exportQuery.set('dataset', reports[report].dataset);
  return <>
    <div className="analytics-detail-toolbar">
      {report === 'realtime' ? <span>最近 5 分钟 · 每 15 秒更新</span> : data ? <DateRangeMenu label={reports[report].title} {...data.range} disabled={loading} onChange={(start, end) => {
        const next = new URLSearchParams(query); next.set('start', start); next.set('end', end); workspace.navigate(report, next.toString());
      }} /> : <span>正在读取日期…</span>}
      <div className="analytics-detail-actions">
        {report !== 'realtime' && <><select aria-label="来源筛选" value={params.get('channel') || ''} onChange={event => apply('channel', event.target.value)}><option value="">全部来源</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <Popover label="筛选报表" trigger={<><SlidersHorizontal size={14} />筛选</>} className="analytics-dimension-popover">
            {close => <>{dimensions.map(([key, rows]) => <label key={key}>{dimensionNames[key]}<select aria-label={dimensionNames[key] + '筛选'} value={params.get(key) || ''} onChange={event => { apply(key, event.target.value); close(); }}>
              <option value="">全部</option>{rows.map(row => <option key={row.name} value={row.name}>{key === 'country' ? country(row.name) : key === 'device' ? devices[row.name] || row.name : row.name}</option>)}
            </select></label>)}</>}
          </Popover></>}
        {reports[report].dataset && data && !loading && !model.error && <a className="analytics-export" href={'/api/admin/v1/analytics/export?' + exportQuery}><Download size={14} />导出 CSV</a>}
        <button disabled={loading} onClick={() => model.load()} aria-label="刷新报表"><RefreshCw size={14} className={loading ? 'spin' : ''} />刷新</button>
      </div>
    </div>
    {filters.length > 0 && <div className="analytics-filter-tags">{filters.map(([key, value]) => <button key={key} onClick={() => apply(key, '')}>{dimensionNames[key]}：{key === 'country' ? country(value) : key === 'channel' ? channels[value] || value : key === 'device' ? devices[value] || value : value}<X size={12} /></button>)}<button onClick={() => { const p = new URLSearchParams(query); for (const [key] of filters) p.delete(key); workspace.navigate(report, p.toString()); }}>清除筛选</button></div>}
  </>;
}
