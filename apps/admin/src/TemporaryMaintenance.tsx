import {useState} from 'react';
import {api} from './api.ts';
import {Dialog} from './Dialog.tsx';
export function TemporaryMaintenance({usage,refresh,onError}:{usage:any;refresh:()=>Promise<unknown>;onError:(message:string)=>void}){
  const [plan,setPlan]=useState<Awaited<ReturnType<typeof preview>>|null>(null),[busy,setBusy]=useState(false);
  const preview=()=>api('maintenance/temporary');
  const size=(bytes:number)=>(bytes/1048576).toFixed(1)+' MB';
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();void refresh().catch(error=>onError('操作已完成，占用信息刷新失败：'+error.message));}catch(error:any){onError(error.message);}finally{setBusy(false);}};
  return <>
    <p>暂存文件 {size(usage.uploadsBytes)} · 导入资料 {size(usage.importsBytes)} · 任务日志 {size(usage.logsBytes)} · 业务数据 {size(usage.businessBytes)}</p>
    {usage.pendingUploads.map((upload:any)=><div className="release-list" key={upload.id}><span>{upload.name} · {size(upload.offset)} / {size(upload.size)}</span>{upload.status==='receiving'&&<button disabled={busy} onClick={()=>void run(()=>api('media/uploads/cancel',{id:upload.id}))}>取消上传</button>}</div>)}
    <button disabled={busy} onClick={()=>void run(async()=>setPlan(await preview()))}>检查可清理的暂存文件</button>
    {plan&&<Dialog label="清理暂存文件" onClose={()=>{if(!busy)setPlan(null);}}>
      <h2>清理暂存文件</h2><p>{plan.files.length} 个已结束或过期的暂存文件，共 {size(plan.bytes)}。</p>
      <ul>{plan.files.map(file=><li key={file.kind+file.id}>{usage.pendingUploads.find((upload:any)=>upload.id===file.id)?.name??file.path} · {size(file.bytes)}</li>)}</ul>
      {plan.skipped.map(file=><p key={file.path}>{file.path}：{file.reason}</p>)}
      <div className="dialog-actions"><button disabled={busy} onClick={()=>setPlan(null)}>关闭</button><button disabled={busy||!plan.files.length} onClick={()=>void run(async()=>{await api('maintenance/temporary/cleanup',{review:plan.review,confirm:true});setPlan(null);})}>删除这 {plan.files.length} 个暂存文件</button></div>
    </Dialog>}
  </>;
}
