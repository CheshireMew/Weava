import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog.tsx';
import {useBackgroundTasks,taskPending} from './background-tasks.ts';
import {useImportWorkspace,uploadImport,runImport,changeImportOption,acceptImportReport} from './import-workspace.ts';

const importFields:Record<string,string>={entries:'内容',types:'内容类型',terms:'分类与标签',layouts:'模板',contentViews:'常用筛选',creationTemplates:'新建模板',redirects:'网址跳转',settings:'网站设置',title:'标题',path:'网址',document:'正文',fields:'自定义字段',name:'名称',version:'版本',value:'导入内容'};
function importErrorLines(error:any):string[]{
  const details=Array.isArray(error?.details)?error.details:Array.isArray(error?.details?.cause)?error.details.cause:[];
  return details.flatMap((detail:any)=>{
    if(!detail||typeof detail!=='object')return typeof detail==='string'&&detail.trim()?[detail]:[];
    if(Array.isArray(detail.path)){
      const location=detail.path.map((part:string|number)=>typeof part==='number'?'第 '+(part+1)+' 项':importFields[part]??part).join(' · ');
      const reason:Record<string,string>={invalid_type:'数据类型不正确',invalid_value:'值不符合要求',too_small:'内容不完整',too_big:'超过允许的长度或数量',invalid_format:'格式不正确'};
      return [([location,reason[detail.code]??'内容格式不正确'].filter(Boolean).join('：'))];
    }
    const reason=typeof detail.reason==='string'?detail.reason:typeof detail.error==='string'?detail.error:typeof detail.message==='string'?detail.message:'';
    const location=[importFields[detail.scope]??detail.scope,detail.id].filter(part=>typeof part==='string'&&part.trim()).join(' · ');
    return reason.trim()?[location?location+'：'+reason:reason]:[];
  });
}

const download = (value: any, name: string) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export default function ImportManager({ refresh }: { refresh: () => Promise<any> }) {
  const workspace=useImportWorkspace(),tasks=useBackgroundTasks('import');
  const source=workspace.source, {settings,media,comments,merge,mediaDirectory}=workspace.options;
  const current=tasks.find(task=>task.id===workspace.taskId),previous=tasks.find(task=>task.id===workspace.reportId);
  const report=current?.job.status==='complete'?current.job.result:previous?.job.status==='complete'?previous.job.result:null;
  const busy=!!(workspace.uploading||workspace.submitting||taskPending(current)||current?.job.status==='unknown');
  const error=workspace.error??(current&&['failed','cancelled'].includes(current.job.status)?{message:current.job.message,details:current.job.errorDetails}:null);
  const [refreshError,setRefreshError]=useState('');
  const progress=workspace.progress||(workspace.submitting?'正在提交任务…':taskPending(current)?current?.readError??current?.job.message:'');
  const [details,setDetails]=useState<{title:string;lines:string[]}|null>(null);
  const refreshed=useRef('');
  useEffect(()=>{
    if(current?.job.status!=='complete')return;
    acceptImportReport(current.id);
    if(workspace.kind==='commit'&&refreshed.current!==current.id){refreshed.current=current.id;void refresh().then(()=>setRefreshError(''),error=>setRefreshError('导入已完成，列表刷新失败：'+error.message));}
  },[current?.job.status,current?.id]);
  return <section className="form-card import-manager"><div className="panel-title"><h2>导入与导出</h2><a className="button" href="/api/admin/v1/export/file" download="weava-site.json">导出网站内容</a></div>
    <p>支持从 Weava 或 WordPress 导出的文件。导入完成后保存在工作稿中，需要另外发布；JSON 不包含媒体文件，完整备份可保存媒体。</p>
    <label className="button">选择导入文件<input type="file" aria-label="选择导入文件" accept=".json,.xml" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void uploadImport(file);event.target.value='';}} /></label>
    {source&&<p>{source.name}</p>}
    <div className="import-options">{([['同时导入站点设置','settings',settings],['合并已有内容','merge',merge],...(source?.format==='wxr'?[['下载来源附件','media',media],['导入来源评论','comments',comments]]:[])] as const).map(([label,key,value])=><label className="checkbox" key={String(key)}><input type="checkbox" disabled={busy} checked={Boolean(value)} onChange={event=>changeImportOption(key as any,event.target.checked)}/>{label}</label>)}</div>
    {source?.format==='wxr'&&media&&<div><label>本地附件目录（可选）<input aria-describedby="import-media-directory-help" value={mediaDirectory} disabled={busy} onChange={event=>changeImportOption('mediaDirectory',event.target.value)}/></label><p id="import-media-directory-help" className="muted">目录位于运行 Weava 的电脑上，内部保留原网址路径，例如 wp-content/uploads。留空则从公网下载；本机或内网站点请使用本地目录。</p></div>}
    <div className="import-actions"><button disabled={busy||!source} onClick={()=>void runImport('preview')}>预检导入</button><button className="primary" disabled={busy||!report?.dryRun} onClick={()=>void runImport('commit',report)}>导入已预检内容</button></div>
    {refreshError&&<p role="alert">{refreshError}<button onClick={()=>refresh().then(()=>setRefreshError(''),error=>setRefreshError('导入已完成，列表刷新失败：'+error.message))}>重新刷新列表</button></p>}
    {progress && <p role="status">{progress}</p>}{error && <div role="alert"><p>{error.message}</p>{importErrorLines(error).length>0&&<ul>{importErrorLines(error).map((line,index)=><li key={index}>{line}</li>)}</ul>}</div>}
    {report && <div className="import-report"><h3>{report.dryRun ? '预检结果' : '导入完成'}</h3>
      {source?.format==='wxr' ? <><p>文章及自定义内容 {report.content} · 页面 {report.pages} · 分类和标签 {report.terms} · 附件 {report.attachments.length} · 评论 {report.comments}</p><p>需检查来源功能的内容 {report.reviewRequired.length} · 保留在原始资料中的系统对象 {report.skipped.length}</p>
        {report.reviewRequired.slice(0, 5).map((item: any) => <section key={item.id}><h4>{item.title}</h4><ul>{item.unresolved.slice(0, 3).map((reason: string) => <li key={reason}>{reason}</li>)}</ul>{item.unresolved.length > 3 && <button onClick={() => setDetails({ title: item.title, lines: item.unresolved })}>查看详情</button>}</section>)}
        {report.reviewRequired.length > 5 && <button onClick={() => setDetails({ title: '需要检查的内容', lines: report.reviewRequired.flatMap((item: any) => item.unresolved.map((reason: string) => item.title + '：' + reason)) })}>查看全部 {report.reviewRequired.length} 项</button>}
        {report.warnings.length > 0 && <section><h4>转换说明</h4><ul>{report.warnings.slice(0, 3).map((message: string) => <li key={message}>{message}</li>)}</ul>{report.warnings.length > 3 && <button onClick={() => setDetails({ title: '转换说明', lines: report.warnings })}>查看详情（{report.warnings.length} 条）</button>}</section>}
        {report.notes.map((note: string) => <p key={note}>{note}</p>)}{!report.dryRun && <p>已导入附件 {report.downloaded} · 新增评论 {report.importedComments}</p>}</> : <p>新增 {report.created.length} · 更新 {report.updated.length} · 相同内容 {report.unchanged.length}</p>}
      <button onClick={() => download(report, 'import-report.json')}>保存转换报告</button>
    </div>}
    {details && <Dialog label={details.title} onClose={() => setDetails(null)}><div className="modal-title"><h2>{details.title}</h2><button onClick={() => setDetails(null)}>关闭</button></div><ul>{details.lines.map((line, index) => <li key={index}>{line}</li>)}</ul></Dialog>}
  </section>;
}
