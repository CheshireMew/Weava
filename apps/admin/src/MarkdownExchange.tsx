import {useState} from 'react';
import {startTask,awaitTask,useBackgroundTasks,taskPending} from './background-tasks.ts';
export function MarkdownExchange(){
  const [path,setPath]=useState(''),[merge,setMerge]=useState(false),[settings,setSettings]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<any>(null),[busy,setBusy]=useState(false);
  const tasks=useBackgroundTasks('markdown'),pending=busy||tasks.some(task=>taskPending(task));
  const options={merge,settings};
  const signature=JSON.stringify({path,options}),checked=review?.signature===signature?review:null;
  async function run(action:'export'|'preview'|'import'){
    setBusy(true);setError('');
    try{const job=await startTask(action==='export'?'export/markdown':action==='preview'?'import/markdown/preview':'import/markdown',action==='export'?{path}:{path,options:{...options,...(action==='import'?{review:checked?.review}:{})}},{scope:'markdown',label:action==='export'?'导出 Markdown':action==='preview'?'预检 Markdown':'导入 Markdown',context:{signature}});const done=await awaitTask(job.id);if(action==='preview')setReview({...done.result,signature});else setReview(null);}
    catch(error:any){setError(error.message);}finally{setBusy(false);}
  }
  return <section className="form-card"><h2>Markdown 文件夹</h2><p>文件夹位于运行 Weava 的电脑上。导出包含正文、元数据与媒体；导入先预检，确认后保存，不自动发布。</p><label>文件夹<input value={path} disabled={pending} onChange={event=>setPath(event.target.value)}/></label><div className="inline"><button disabled={pending||!path.trim()} onClick={()=>void run('export')}>导出到新目录</button><button disabled={pending||!path.trim()} onClick={()=>void run('preview')}>预检目录</button></div><label className="checkbox"><input type="checkbox" disabled={pending} checked={merge} onChange={event=>setMerge(event.target.checked)}/>合并已有内容</label><label className="checkbox"><input type="checkbox" disabled={pending} checked={settings} onChange={event=>setSettings(event.target.checked)}/>同时导入站点设置</label>
    {checked&&<><p>{checked.entries.length} 篇内容 · {checked.media} 个附件 · {(checked.bytes/1048576).toFixed(1)} MB</p><ul>{checked.entries.slice(0,20).map((item:any)=><li key={item.id}>{item.title} · {item.path}</li>)}</ul><button disabled={pending} onClick={()=>void run('import')}>确认导入已检查目录</button></>}
    {pending&&<p role="status">正在后台处理，可以稍后在任务记录查看。</p>}{error&&<p role="alert">{error}</p>}
    {tasks.filter(task=>!taskPending(task)).slice(-3).map(task=><p key={task.id} role={task.job.status==='failed'?'alert':'status'}>{task.label}：{task.job.status==='complete'?'已完成':task.job.message}{task.job.result?.path&&' · '+task.job.result.path}</p>)}
  </section>;
}
