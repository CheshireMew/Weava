import {useEffect} from 'react';
import {useAdminQuery} from '../useAdminQuery.ts';
import {watchVisible} from './polling.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function CollectionHealth(){
  const query=useAdminQuery<ApiOutput<'analyticsHealth'>>('analytics/health');
  useEffect(()=>{const watch=watchVisible(()=>query.refresh(),()=>{},()=>{},30000);return watch.stop;},[query.refresh]);
  const data=query.data;
  return <>{!!data?.archives&&<p role="status">UTC {data.archivedBefore} 之前的部分明细已归档；日期报告只含在线明细，累计数包含归档。可查看“统计归档”的每日汇总，或恢复明细。</p>}<details className="analytics-collection-health"><summary>{data?data.collecting?'统计采集中':'统计采集已暂停':'统计采集状态'}</summary>
    {query.error&&<p role="alert">采集状态读取失败：{query.error}<button onClick={()=>void query.refresh().catch(()=>{})}>重试</button></p>}
    {data&&<><p role={data.collecting?'status':'alert'}>{data.reason||'可以接收新的统计。'}</p><p>最近成功接收：{data.lastAcceptedAt?new Date(data.lastAcceptedAt).toLocaleString():'暂无记录'}</p><p>统计库 {(data.bytes/1048576).toFixed(1)} / {(data.maximumBytes/1048576).toFixed(0)} MB · 今日采集 {data.dailyEvents.toLocaleString()} / {data.dailyLimit.toLocaleString()} · 剩余空间 {(data.freeBytes/1073741824).toFixed(1)} GB</p></>}
  </details></>;
}
