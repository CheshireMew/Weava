import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useBackgroundTasks } from './background-tasks.ts';
import { importFile, resumeImport, useImportWorkspace } from './import-workspace.ts';

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

export default function ImportManager({ refresh }: { refresh: () => Promise<any> }) {
  const workspace=useImportWorkspace(),tasks=useBackgroundTasks('import');
  const input=useRef<HTMLInputElement>(null),refreshed=useRef('');
  const [refreshError,setRefreshError]=useState('');
  const {phase,commitId}=workspace;
  const current=tasks.find(task=>task.id===(phase==='preview'?workspace.previewId:commitId));
  const busy=phase==='upload'||phase==='preview'||phase==='commit';
  const progress=current?.readError??(phase==='upload'?workspace.progress:phase==='preview'?'正在检查文件…':'正在导入…');
  const error=workspace.error;
  const lines=importErrorLines(error);
  const report=phase==='complete'?current?.job.result:null;
  const warnings:string[]=report?.warnings??[];
  const needsReview:{id:string;title:string;unresolved:string[]}[]=report?.reviewRequired??[];

  useEffect(resumeImport,[]);
  async function refreshList(){
    try{await refresh();setRefreshError('');}
    catch{setRefreshError('导入已完成，列表刷新失败。');}
  }
  useEffect(()=>{
    if(phase==='complete'&&commitId&&refreshed.current!==commitId){
      refreshed.current=commitId;
      void refreshList();
    }
  },[phase,commitId]);

  return <section className="form-card import-manager" aria-label="导入与导出">
    <div className="import-actions">
      <button type="button" className="primary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={17} aria-hidden="true"/>导入文件</button>
      <input ref={input} type="file" hidden aria-label="选择导入文件" accept=".md,.markdown,.json,.xml" disabled={busy} onChange={event=>{
        const file=event.target.files?.[0];
        if(file){setRefreshError('');importFile(file);}
        event.target.value='';
      }}/>
      <a className="button" href="/api/admin/v1/export/file" download="weava-site.json"><Download size={17} aria-hidden="true"/>导出内容</a>
    </div>
    <p className="muted import-hint">支持 Markdown、Weava JSON 和 WordPress XML</p>
    {(busy||phase==='complete'||phase==='failed')&&<div className="import-feedback">
      {busy&&<p role="status">{progress}</p>}
      {phase==='failed'&&<div role="alert">
        <p>{error?.message??'导入未完成，请重新选择文件。'}</p>
        {lines.length>0&&<details><summary>查看原因</summary><ul>{lines.map((line,index)=><li key={index}>{line}</li>)}</ul></details>}
      </div>}
      {phase==='complete'&&<>
        <p role="status">导入完成。新增内容已保存为草稿。</p>
        {(warnings.length>0||needsReview.length>0)&&<details><summary>查看导入说明</summary>
          {warnings.length>0&&<ul>{warnings.map((line,index)=><li key={index}>{line}</li>)}</ul>}
          {needsReview.length>0&&<ul>{needsReview.map(item=><li key={item.id}>{item.title}：{item.unresolved.join('；')}</li>)}</ul>}
        </details>}
      </>}
      {refreshError&&<div role="alert"><p>{refreshError}</p><button type="button" onClick={()=>void refreshList()}>重新刷新</button></div>}
    </div>}
  </section>;
}
