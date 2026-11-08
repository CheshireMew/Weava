import { Download, SlidersHorizontal, X } from 'lucide-react';
import { Popover } from '../Popover.tsx';
import { channels, country, devices } from './format.ts';
import { reports, filterKeys, type ReportName } from './report-navigation.ts';
import type { AnalyticsController } from './useAnalyticsReport.ts';
import type {AnalyticsReport} from '@weava/contracts';
import {useAdminQuery} from '../useAdminQuery.ts';
import {LoadingState} from '../LoadingState.tsx';

const dimensionNames: Record<string, string> = { country: '国家 / 地区', browser: '浏览器', os: '操作系统', device: '设备类型', model: '设备型号', path: '页面', channel: '来源' };
const filterEntries = (query: string) => [...new URLSearchParams(query)].filter(([key]) => [...filterKeys, 'path'].includes(key));
export function AnalyticsControls({ model, report, query, onChange }: { model: AnalyticsController; report: ReportName | null; query: string; onChange: (query: string) => void }) {
  const { data, loading } = model, params = new URLSearchParams(query);
  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(query); if (value) next.set(key, value); else next.delete(key); onChange(next.toString());
  };
  const dataset = report && report !== 'actions' ? reports[report].dataset : '';
  const exportQuery = new URLSearchParams(query); if (dataset) exportQuery.set('dataset', dataset);
  const filterCount = filterEntries(query).length;
  return <div className="analytics-toolbar-actions">
    <Popover label="筛选报表" trigger={<><SlidersHorizontal size={15} />筛选{filterCount > 0 && <span>（{filterCount}）</span>}</>} className="analytics-dimension-popover">
      {close => <>
        <label>来源<select aria-label="来源筛选" value={params.get('channel') || ''} disabled={loading} onChange={event => { apply('channel', event.target.value); close(); }}><option value="">全部来源</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <DimensionFilters data={data} query={query} loading={loading} apply={(key,value)=>{apply(key,value);close();}}/>
      </>}
    </Popover>
    {dataset && data && !loading && !model.error && <a className="analytics-export" href={'/api/admin/v1/analytics/export?' + exportQuery}><Download size={15} />导出 CSV</a>}
  </div>;
}
function DimensionFilters({data,query,loading,apply}:{data:AnalyticsReport|null;query:string;loading:boolean;apply:(key:string,value:string)=>void}){
  const params=new URLSearchParams(query),requestQuery=new URLSearchParams(query);requestQuery.set('section','filters');
  const facets=useAdminQuery<AnalyticsReport>(data?.section&&data.section!=='all'?`analytics?${requestQuery}`:null,15000),values=facets.data??data;
  const dimensions=values?[['country',values.countries],['browser',values.browsers],['os',values.operatingSystems],['device',values.devices],['model',values.models]] as const:[];
  const label=(key:string,value:string)=>key==='country'?country(value):key==='device'?devices[value]||value:value;
  return <>
    {facets.loading&&<LoadingState label="读取筛选项" />}
    {facets.error&&<div role="alert"><p>{facets.error}</p><button onClick={()=>facets.refresh().catch(()=>{})}>重新读取筛选项</button></div>}
    {dimensions.map(([key,rows])=><label key={key}>{dimensionNames[key]}<select aria-label={dimensionNames[key]+'筛选'} disabled={loading||facets.loading||!!facets.error} value={params.get(key)||''} onChange={event=>apply(key,event.target.value)}><option value="">全部</option>{params.get(key)&&!rows.some(row=>row.name===params.get(key))&&<option value={params.get(key)!}>{label(key,params.get(key)!)}</option>}{rows.map(row=><option key={row.name} value={row.name}>{label(key,row.name)}</option>)}</select></label>)}
  </>;
}
export function AnalyticsFilterTags({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const filters = filterEntries(query);
  if (!filters.length) return null;
  return <div className="analytics-filter-tags">{filters.map(([key, value]) => <button key={key} onClick={() => { const p = new URLSearchParams(query); p.delete(key); onChange(p.toString()); }}>{dimensionNames[key]}：{key === 'country' ? country(value) : key === 'channel' ? channels[value] || value : key === 'device' ? devices[value] || value : value}<X size={13} /></button>)}<button onClick={() => { const p = new URLSearchParams(query); for (const [key] of filters) p.delete(key); onChange(p.toString()); }}>清除筛选</button></div>;
}
