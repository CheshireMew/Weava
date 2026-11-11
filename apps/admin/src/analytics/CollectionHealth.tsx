import {useEffect} from 'react';
import {useAdminQuery} from '../useAdminQuery.ts';
import {watchVisible} from './polling.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function CollectionHealth(){
  const query=useAdminQuery<ApiOutput<'analyticsHealth'>>('analytics/health');
  useEffect(()=>{const watch=watchVisible(()=>query.refresh(),()=>{},()=>{},30000);return watch.stop;},[query.refresh]);
  const data=query.data;
  if(query.error)return <p className="analytics-error" role="alert">暂时无法确认统计是否正常更新。<button onClick={()=>void query.refresh().catch(()=>{})}>重试</button></p>;
  if(!data||data.collecting)return null;
  const reason=data.reason??'';
  const message=reason.includes('次日')?'今日访问量较大，新的统计将在次日自动恢复。':reason.includes('磁盘')?'服务器空间不足，新的访问暂时无法记录，请释放服务器空间。':reason.includes('容量上限')?'统计存储空间已满，新的访问暂时无法记录，请联系维护人员整理统计存储。':'新的访问暂时无法记录，请联系维护人员检查统计服务。';
  return <p className="analytics-error analytics-collection-health" role="alert">{message} 已有统计仍可查看。</p>;
}
