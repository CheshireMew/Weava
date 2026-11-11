import {useState,useEffect} from 'react';
import {useAdminQuery} from '../useAdminQuery.ts';
import {api} from '../api.ts';
import {startTask,awaitTask,useBackgroundTasks,taskPending} from '../background-tasks.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function AnalyticsArchive({query:applied}:{query:string}){
  const [before,setBefore]=useState(''),[review,setReview]=useState<ApiOutput<'previewAnalyticsArchive'>|null>(null),[reading,setReading]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1);
  const dates=new URLSearchParams(applied),start=dates.get('start')??'2000-01-01',end=dates.get('end')??new Date().toISOString().slice(0,10);
  useEffect(()=>setPage(1),[start,end]);
  const archives=useAdminQuery<ApiOutput<'analyticsArchives'>>('analytics/archives'),days=useAdminQuery<ApiOutput<'analyticsArchiveDays'>>('analytics/archive/days?'+new URLSearchParams({start,end,page:String(page)}));
  const tasks=useBackgroundTasks('analytics-archive'),pending=reading||tasks.some(task=>taskPending(task));
  async function execute(action:'archive'|'restore',id?:string){setReading(true);setError('');try{const job=await startTask(action==='archive'?'analytics/archive':'analytics/archive/restore',action==='archive'?{before,review:review!.review}:{id},{scope:'analytics-archive',label:action==='archive'?'归档统计明细':'恢复统计明细'});await awaitTask(job.id);setReview(null);await Promise.all([archives.refresh(),days.refresh()]);}catch(error:any){setError(error.message);}finally{setReading(false);}}
  return <section className="analytics-card analytics-archive"><div className="analytics-card-title"><h2>统计归档</h2></div><p>归档保留 UTC 每日汇总和完整可恢复文件，累计浏览、点击、访客及会话保持不变。日期报表和访客轨迹只查询在线明细，恢复后可重新查询完整记录。归档释放的数据库页会复用，不立即缩小文件。</p>
    <label>归档此日期之前的明细（UTC）<input type="date" value={before} disabled={pending} onChange={event=>{setBefore(event.target.value);setReview(null);}}/></label><button disabled={pending||!before} onClick={async()=>{setReading(true);setError('');try{setReview(await api('analytics/archive/preview',{before}));}catch(error:any){setError(error.message);}finally{setReading(false);}}}>预检归档</button>
    {review&&<><p>{review.events} 条明细 · {review.views} 次浏览 · {review.clicks} 次点击 · 预计新增 {(review.estimatedBytes/1048576).toFixed(1)} MB</p><button disabled={pending||!review.events} onClick={()=>void execute('archive')}>确认归档这些明细</button></>}
    {(error||archives.error||days.error)&&<p role="alert">{error||archives.error||days.error}<button onClick={()=>void Promise.all([archives.refresh(),days.refresh()]).catch(error=>setError(error.message))}>重新读取</button></p>}
    {pending&&<p role="status">正在后台处理…</p>}
    <h3>归档文件</h3>{archives.data?.map(item=><article className="form-card" key={item.id}><p>{new Date(item.createdAt).toLocaleString()} · 截止 {item.before} · {item.events} 条 · {(item.bytes/1048576).toFixed(1)} MB</p><p>{item.path}</p>{item.restoredAt?<p>已恢复：{new Date(item.restoredAt).toLocaleString()}</p>:<button disabled={pending} onClick={()=>void execute('restore',item.id)}>校验并恢复明细</button>}</article>)}
    <h3>归档汇总（UTC）</h3><p>{start} — {end}；访客与会话是各日各页面的去重数，不能跨行相加。</p><div className="data-table-scroll"><table><thead><tr>{['日期','页面','浏览','点击','访客','会话'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{days.data?.items.map(item=><tr key={item.day+item.path}><td>{item.day}</td><td>{item.path}</td><td>{item.views}</td><td>{item.clicks}</td><td>{item.visitors}</td><td>{item.sessions}</td></tr>)}</tbody></table></div>{days.data?.pages&&days.data.pages>1?<nav aria-label="统计归档汇总分页"><button disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {days.data.pages}</span><button disabled={page>=days.data.pages} onClick={()=>setPage(page+1)}>下一页</button></nav>:null}
  </section>;
}
