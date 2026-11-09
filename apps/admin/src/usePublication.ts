import {useRef,useState} from 'react';
import {api} from './api.ts';
import {useBackgroundTasks,startTask,awaitTask,taskPending} from './background-tasks.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function usePublication(refresh:()=>Promise<any>,setError:(message:string)=>void,notify:(message:string)=>void) {
  const all=useBackgroundTasks(),tasks=all.filter(task=>task.scope==='publication');
  const [submitting,setSubmitting]=useState<{key:string;operation:string;ids?:string[]}[]>([]),[publication,setPublication]=useState<ApiOutput<'publication'>|null>(null);
  const active=useRef(new Set<string>());
  const pending=(operation:string)=>tasks.some(task=>task.job.operation===operation&&taskPending(task))||submitting.some(item=>item.operation===operation);
  const isPublishing=(id?:string)=>!!id&&(submitting.some(item=>item.operation==='publish'&&!!item.ids?.includes(id))||tasks.some(task=>task.job.operation==='publish'&&taskPending(task)&&task.context?.ids?.includes(id)));
  async function submit(operation:'publish'|'backup'|'verify',payload:any={}) {
    const key=operation+':'+JSON.stringify(payload.ids??[]);
    if(active.current.has(key))return;
    const existing=tasks.find(task=>task.job.operation===operation&&taskPending(task)&&JSON.stringify(task.context?.ids??[])===JSON.stringify(payload.ids??[]));
    if(existing)return existing.job;
    active.current.add(key);setSubmitting(items=>[...items,{key,operation,ids:payload.ids}]);setError('');
    try{
      const job=await startTask(operation,payload,{scope:'publication',label:operation==='publish'?'发布内容':operation==='backup'?'完整备份':'检查备份',context:{ids:payload.ids}});
      void awaitTask(job.id).then(()=>{
        void refresh().catch(error=>setError('操作已完成，刷新页面数据失败：'+error.message));
        notify(operation==='publish'?'已发布':operation==='backup'?'备份已创建':'备份检查完成');
      },error=>setError(error.message));
      return job;
    }catch(error:any){setError(error.message);}
    finally{active.current.delete(key);setSubmitting(items=>items.filter(item=>item.key!==key));}
  }
  async function task(operation:'publish'|'backup'|'verify',payload:any={},reviewed=false){
    if(operation==='publish'&&!reviewed){
      if(active.current.has('review'))return;active.current.add('review');setSubmitting(items=>[...items,{key:'review',operation,ids:payload.ids}]);setError('');
      try{const review=await api('publication',payload);setPublication(review);return review;}catch(error:any){setError(error.message);}finally{active.current.delete('review');setSubmitting(items=>items.filter(item=>item.key!=='review'));}
      return;
    }
    const job=await submit(operation,payload);if(!job)return;
    try{return await awaitTask(job.id);}catch{/* The independent task observer reports this error. */}
  }
  return {busy:submitting.some(item=>item.operation==='publish'),job:all.find(task=>taskPending(task))?.job??null,publication,setPublication,task,submit,pending,isPublishing};
}
export type PublicationController=ReturnType<typeof usePublication>;
