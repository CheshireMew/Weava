import {useEffect,useRef,useState} from 'react';
import {Dialog} from './Dialog.tsx';
import {api} from './api.ts';
import {useBackgroundTasks,startTask,taskPending} from './background-tasks.ts';
export default function HistoryMaintenance({refresh}:{refresh:()=>Promise<any>}) {
  const before=new Date(Date.now()-90*86400000).toISOString().slice(0,10),keepReleases=20,keepRevisions=20;
  const [plan,setPlan]=useState<any>(null),[archives,setArchives]=useState<any[]>([]),[contents,setContents]=useState<any>(null),[submitting,setSubmitting]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[refreshError,setRefreshError]=useState('');
  const tasks=useBackgroundTasks('history'),active=tasks.find(task=>taskPending(task)||task.job.status==='unknown'),latest=tasks.at(-1);
  const busy=submitting||!!active;
  const load=()=>api('maintenance/archives').then(setArchives);
  const reload=()=>Promise.all([load(),refresh()]).then(()=>setRefreshError(''),error=>setRefreshError('操作已完成，列表刷新失败：'+error.message));
  useEffect(()=>{void load().catch(error=>setError(error.message));},[]);
  const refreshed=useRef('');
  useEffect(()=>{if(latest?.job.status==='complete'&&refreshed.current!==latest.id){refreshed.current=latest.id;void reload();}},[latest?.id,latest?.job.status]);
  const run=async(action:'maintenance/archive'|'maintenance/restore',value:any)=>{setSubmitting(true);setError('');try{await startTask(action,value,{scope:'history',label:action.endsWith('restore')?'恢复历史':'归档历史'});setPlan(null);}catch(error:any){setError(error.message);}finally{setSubmitting(false);}};
  const read=(id:string,page=1)=>api(`maintenance/archive?id=${encodeURIComponent(id)}&page=${page}`).then(setContents).catch(error=>setError(error.message));
  const message=active?(active.readError??active.job.message??'任务已提交'):latest?.job.status==='complete'?(latest.job.operation==='restore-history'?'历史已恢复到版本列表。':'已归档 '+latest.job.result.releases+' 个公开版本、'+latest.job.result.revisions+' 个修订。'):'';
  const taskError=latest&&['failed','cancelled'].includes(latest.job.status)?latest.job.message:'';
  return <section className="form-card"><h2>历史归档</h2><p>把较旧的版本移入可恢复归档，保留当前工作稿、当前公开版本和待执行计划。媒体文件继续保留。</p>
    <button disabled={checking} onClick={async()=>{setChecking(true);setError('');try{setPlan(await api('maintenance/preview',{before:new Date(before+'T00:00:00').toISOString(),keepReleases,keepRevisions}));}catch(error:any){setError(error.message);}finally{setChecking(false);}}}>检查可整理的历史</button>
    {plan&&<div><p>准备归档 {plan.releases} 个公开版本、{plan.revisions} 个修订；保留 {plan.protectedReleases} 个公开版本和 {plan.protectedRevisions} 个受保护修订。</p><button className="primary" disabled={busy||!plan.releases&&!plan.revisions} onClick={()=>void run('maintenance/archive',{options:plan.options,review:plan.review})}>整理并保留恢复记录</button></div>}
    {(error||taskError)&&<p role="alert">{error||taskError}</p>}{message&&<p role="status">{message}</p>}
    {refreshError&&<p role="alert">{refreshError}<button onClick={()=>void reload()}>重新刷新列表</button></p>}
    {archives.map(archive=><div className="history-archive-row" key={archive.id}><span>{new Date(archive.createdAt).toLocaleString()} · {archive.releases} 个公开版本 · {archive.revisions} 个修订</span><button onClick={()=>void read(archive.id)}>查看归档</button><button disabled={busy} onClick={()=>void run('maintenance/restore',{id:archive.id})}>恢复历史记录</button></div>)}
    {contents&&<Dialog label="归档内容" onClose={()=>setContents(null)}><div className="modal-title"><h2>归档内容</h2><button onClick={()=>setContents(null)}>关闭</button></div><p>公开版本 {contents.totalReleases} · 修订 {contents.totalRevisions}</p><ul>{contents.releases.map((release:any)=><li key={release.id}>公开版本 · {new Date(release.createdAt).toLocaleString()}</li>)}{contents.revisions.map((revision:any)=><li key={revision.revision}>{revision.label||revision.id} · {revision.revision} · {new Date(revision.createdAt).toLocaleString()}</li>)}</ul><nav aria-label="归档分页"><button disabled={contents.page===1} onClick={()=>void read(contents.id,contents.page-1)}>上一页</button><span>第 {contents.page} / {contents.pages} 页</span><button disabled={contents.page>=contents.pages} onClick={()=>void read(contents.id,contents.page+1)}>下一页</button></nav></Dialog>}
  </section>;
}
