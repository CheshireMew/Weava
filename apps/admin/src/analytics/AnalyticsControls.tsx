import { Download, SlidersHorizontal, X } from 'lucide-react';
import { Popover } from '../Popover.tsx';
import { channels, country, devices } from './format.ts';
import { reports, filterKeys, type ReportName } from './report-navigation.ts';
import type { AnalyticsController } from './useAnalyticsReport.ts';

const dimensionNames: Record<string, string> = { country: '国家 / 地区', browser: '浏览器', os: '操作系统', device: '设备类型', model: '设备型号', path: '页面', channel: '来源' };
const filterEntries = (query: string) => [...new URLSearchParams(query)].filter(([key]) => [...filterKeys, 'path'].includes(key));
export function AnalyticsControls({ model, report, query, onChange }: { model: AnalyticsController; report: ReportName | null; query: string; onChange: (query: string) => void }) {
  const { data, loading } = model, params = new URLSearchParams(query);
  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(query); if (value) next.set(key, value); else next.delete(key); onChange(next.toString());
  };
  const dimensions = data ? [['country', data.countries], ['browser', data.browsers], ['os', data.operatingSystems], ['device', data.devices], ['model', data.models]] as const : [];
  const dataset = report && report !== 'actions' ? reports[report].dataset : '';
  const exportQuery = new URLSearchParams(query); if (dataset) exportQuery.set('dataset', dataset);
  const filterCount = filterEntries(query).length;
  return <div className="analytics-toolbar-actions">
    <Popover label="筛选报表" trigger={<><SlidersHorizontal size={15} />筛选{filterCount > 0 && <span>（{filterCount}）</span>}</>} className="analytics-dimension-popover">
      {close => <>
        <label>来源<select aria-label="来源筛选" value={params.get('channel') || ''} disabled={loading} onChange={event => { apply('channel', event.target.value); close(); }}><option value="">全部来源</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {dimensions.map(([key, rows]) => <label key={key}>{dimensionNames[key]}<select aria-label={dimensionNames[key] + '筛选'} value={params.get(key) || ''} onChange={event => { apply(key, event.target.value); close(); }}>
          <option value="">全部</option>{rows.map(row => <option key={row.name} value={row.name}>{key === 'country' ? country(row.name) : key === 'device' ? devices[row.name] || row.name : row.name}</option>)}
        </select></label>)}
      </>}
    </Popover>
    {dataset && data && !loading && !model.error && <a className="analytics-export" href={'/api/admin/v1/analytics/export?' + exportQuery}><Download size={15} />导出 CSV</a>}
  </div>;
}
export function AnalyticsFilterTags({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const filters = filterEntries(query);
  if (!filters.length) return null;
  return <div className="analytics-filter-tags">{filters.map(([key, value]) => <button key={key} onClick={() => { const p = new URLSearchParams(query); p.delete(key); onChange(p.toString()); }}>{dimensionNames[key]}：{key === 'country' ? country(value) : key === 'channel' ? channels[value] || value : key === 'device' ? devices[value] || value : value}<X size={13} /></button>)}<button onClick={() => { const p = new URLSearchParams(query); for (const [key] of filters) p.delete(key); onChange(p.toString()); }}>清除筛选</button></div>;
}
