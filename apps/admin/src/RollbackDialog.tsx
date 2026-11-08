import {useEffect,useState} from 'react';
import type {ApiOutput} from '@weava/contracts/api';
import {api} from './api.ts';
import {Dialog} from './Dialog.tsx';
import {LoadingState} from './LoadingState.tsx';

export function RollbackDialog({id,onClose,onRestored,onError}:{id:string;onClose:()=>void;onRestored:()=>unknown;onError:(message:string)=>void}){
  const [review,setReview]=useState<ApiOutput<'previewRollback'>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[restoring,setRestoring]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setLoading(true);setReview(null);setError('');
    api('rollback/preview',{id}).then(value=>{if(active)setReview(value);},error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[id,attempt]);
  return <Dialog label="恢复公开版本" onClose={onClose} dismissible={!restoring}>
    <div className="modal-title"><h2>恢复公开版本</h2><button disabled={restoring} onClick={onClose}>关闭</button></div>
    {loading&&<LoadingState label="检查恢复内容" />}
    {error&&<div role="alert"><p>{error}</p><button disabled={restoring} onClick={()=>setAttempt(value=>value+1)}>重新检查</button></div>}
    {review&&<>
      <p>{new Date(review.createdAt).toLocaleString()} · {review.label}</p>
      <p>版本 {review.id}</p>
      <p>确认后更新访客看到的网站，当前工作稿会保留。</p>
      {review.settingsChanged&&<p>恢复网站设置</p>}{review.layoutsChanged&&<p>恢复页面模板与共享区域</p>}{review.typesChanged&&<p>恢复内容结构</p>}{review.termsChanged&&<p>恢复分类与标签</p>}{review.routesChanged&&<p>恢复网址别名</p>}
      {review.entries.map(entry=><p key={entry.id}>{entry.action==='add'?'重新公开':'恢复内容'} · {entry.title}<small>{entry.path}</small></p>)}
      {review.removed.map(entry=><p key={entry.id}>撤下 · {entry.title}<small>{entry.path}</small></p>)}
      {review.id===review.baseReleaseId&&<p>这已经是当前公开版本。</p>}
    </>}
    <div className="dialog-actions"><button disabled={restoring} onClick={onClose}>取消</button><button className="primary" disabled={loading||restoring||!!error||!review||review.id===review.baseReleaseId} onClick={async()=>{
      if(!review)return;setRestoring(true);setError('');
      try{await api('rollback',{id:review.id,baseReleaseId:review.baseReleaseId,review:review.review});onClose();void Promise.resolve().then(onRestored).catch(error=>onError('公开版本已恢复，读取列表失败：'+error.message));}
      catch(error:any){setError(error.message);}finally{setRestoring(false);}
    }}>{restoring?'正在恢复…':'确认恢复'}</button></div>
  </Dialog>;
}
