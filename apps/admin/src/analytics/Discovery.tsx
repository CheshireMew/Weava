import {useState,useEffect} from 'react';
import {useAdminQuery} from '../useAdminQuery.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function Discovery({query:current}:{query:string}){
  const [open,setOpen]=useState(false),[dataset,setDataset]=useState<'search'|'missing'>('search'),[page,setPage]=useState(1);
  const applied=new URLSearchParams(current),params=new URLSearchParams({dataset,page:String(page),...(applied.get('start')?{start:applied.get('start')!}:{}),...(applied.get('end')?{end:applied.get('end')!}:{})});
  useEffect(()=>setPage(1),[dataset,current]);
  const report=useAdminQuery<ApiOutput<'analyticsDiscovery'>>(open?'analytics/discovery?'+params:null),data=report.data;
  return <details className="form-card analytics-discovery" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>站内搜索与失效网址</summary><p>使用当前日期范围；不使用来源、设备和地区筛选。</p><div role="group" aria-label="内容发现报告"><button aria-pressed={dataset==='search'} onClick={()=>setDataset('search')}>站内搜索</button><button aria-pressed={dataset==='missing'} onClick={()=>setDataset('missing')}>访客 404</button><button onClick={()=>void report.refresh().catch(()=>{})}>刷新报告</button></div>
    {report.error&&<p role="alert">{report.error}</p>}{report.loading&&<p role="status">正在读取…</p>}
    {data&&<div className="data-table-scroll"><table><thead><tr>{(dataset==='search'?['搜索词','搜索次数','无结果','点击过的搜索','结果点击次数']:['失效网址','来源','访问次数']).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{dataset==='search'?data.items.map(item=><tr key={item.query}><td>{item.query}</td><td>{item.searches}</td><td>{item.emptyResults}</td><td>{item.clickedSearches}</td><td>{item.clicks}</td></tr>):data.missing.map(item=><tr key={item.path+item.referrer}><td>{item.path}</td><td>{item.referrer||'直接访问／未知'}</td><td>{item.requests}</td></tr>)}</tbody></table>{!data.total&&<p>所选日期没有记录。</p>}{data.pages>1&&<nav aria-label="内容发现报告分页"><button disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {data.pages}</span><button disabled={page>=data.pages} onClick={()=>setPage(page+1)}>下一页</button></nav>}</div>}
  </details>;
}
