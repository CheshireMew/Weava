import {useEffect,useState} from 'react';
import {api} from './api.ts';
import {useAdminQuery} from './useAdminQuery.ts';
import {useManagedRecord} from './EditSessions.tsx';
import {AutosaveStatus} from './AutosaveStatus.tsx';
import {Dialog} from './Dialog.tsx';
import {startTask,awaitTask,useBackgroundTasks,taskPending} from './background-tasks.ts';
import {jobStatusLabels} from './admin-labels.ts';
import type {ApiOutput} from '@weava/contracts/api';
export default function BackupManager({onError}:{onError:(message:string)=>void}){
  const query=useAdminQuery<ApiOutput<'backupPolicy'>>('backup/policy');
  const editor=useManagedRecord<any>(query.data??null,record=>api('backup/policy',{value:record.value,revision:record.revision}),'备份设置',{autosave:{ready:record=>!!record.value.path.trim()&&/^([01]\d|2[0-3]):[0-5]\d$/.test(record.value.time)}});
  useEffect(()=>{if(query.data)editor.session.receive(query.data);},[query.data]);
  const row=editor.record;
  const inventory=useAdminQuery<ApiOutput<'backupInventory'>>(row?'backup/inventory?'+new URLSearchParams({path:row.value.path}):null);
  const tasks=useBackgroundTasks('backup'),pending=tasks.some(task=>taskPending(task));
  const completion=tasks.filter(task=>!taskPending(task)).map(task=>task.id+task.job.status).join(',');
  useEffect(()=>{if(completion)void inventory.refresh().catch(error=>onError(error.message));},[completion]);
  const [dialog,setDialog]=useState<'location'|'verify'|null>(null),[path,setPath]=useState(''),[error,setError]=useState('');
  async function run(operation:'backup'|'verify',path:string){try{await editor.session.save();const job=await startTask(operation,{path},{scope:'backup',label:operation==='backup'?'完整备份':'校验备份'});await awaitTask(job.id);await inventory.refresh();}catch(error:any){setError(error.message);onError(error.message);}}
  if(!row)return <section className="form-card"><h2>完整备份</h2>{query.error?<p role="alert">{query.error}<button onClick={()=>void query.refresh().catch(error=>onError(error.message))}>重新读取</button></p>:<p>正在读取…</p>}</section>;
  const update=(patch:Partial<typeof row.value>)=>editor.setRecord({...row,value:{...row.value,...patch}});
  return <>
    <section className="form-card settings-form"><h2>完整备份</h2><p>保存网站内容、设置和媒体文件，以便恢复整个网站。</p>
      <div className="backup-location"><span>保存位置：{row.value.path}</span><button onClick={()=>{setPath(row.value.path);setDialog('location');}}>更改位置</button></div>
      <div className="inline"><button className="primary" disabled={pending||!row.value.path.trim()} onClick={()=>void run('backup',row.value.path)}>创建备份</button><button disabled={pending} onClick={()=>{setPath('');setDialog('verify');}}>检查已有备份</button></div>
      <label className="checkbox"><input type="checkbox" checked={row.value.enabled} onChange={event=>update({enabled:event.target.checked})}/>每日自动备份</label>
      {row.value.enabled&&<label>每日时间（{query.data?.timezone}）<input type="time" value={row.value.time} onChange={event=>update({time:event.target.value})}/></label>}
      <AutosaveStatus state={editor.autoSave} label="备份设置"/>{(error||inventory.error)&&<p role="alert">{error||inventory.error}</p>}
    </section>
    <section className="form-card"><div className="modal-title"><h2>已有备份</h2><button onClick={()=>void inventory.refresh().catch(error=>onError(error.message))}>刷新备份</button></div>
      {inventory.data&&!inventory.data.items.length&&<p>这个目录还没有备份。</p>}
      {inventory.data?.items.map(item=><article key={item.path} className="backup-inventory-item"><strong>{item.label||item.id}</strong><p>{item.createdAt?new Date(item.createdAt).toLocaleString():item.id} · {item.files} 个文件</p><p>{item.path}</p><p>{item.error?'校验失败：'+item.error:item.verifiedAt?'最近校验：'+new Date(item.verifiedAt).toLocaleString():'尚未校验'}</p><button disabled={pending} onClick={()=>void run('verify',item.path)}>校验这份备份</button></article>)}
    </section>
    <section className="form-card"><h2>最近备份任务</h2>{inventory.data?.jobs.map(job=><p key={job.id}>{new Date(job.createdAt).toLocaleString()} · {job.operation==='backup'?'备份':'校验'} · {jobStatusLabels[job.status]} · {job.message}</p>)}</section>
    {dialog&&<Dialog label={dialog==='location'?'更改备份位置':'检查已有备份'} onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();if(dialog==='location')update({path:path.trim()});else void run('verify',path.trim());setDialog(null);}}><h2>{dialog==='location'?'更改备份位置':'检查已有备份'}</h2><label>文件夹<input required value={path} onChange={event=>setPath(event.target.value)}/></label><div className="dialog-actions"><button type="button" onClick={()=>setDialog(null)}>取消</button><button disabled={!path.trim()}>{dialog==='location'?'使用此位置':'检查备份是否完整'}</button></div></form></Dialog>}
  </>;
}
