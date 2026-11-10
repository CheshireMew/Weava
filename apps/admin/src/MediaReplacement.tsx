import {useState} from 'react';
import {useSelectors} from './Selectors.tsx';
import {api,waitJob} from './api.ts';
import {Dialog} from './Dialog.tsx';
import type {ApiOutput} from '@weava/contracts/api';
import {mediaKind} from '@weava/contracts';
export function MediaReplacement({id,url,onError}:{id:string;url:string;onError:(message:string)=>void}){
  const selectors=useSelectors(),[open,setOpen]=useState(false),[target,setTarget]=useState<{id:string;url:string}|null>(null),[review,setReview]=useState<ApiOutput<'previewMediaReplacement'>|null>(null),[saved,setSaved]=useState<ApiOutput<'applyMediaReplacement'>|null>(null),[publication,setPublication]=useState<ApiOutput<'publication'>|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[published,setPublished]=useState(false);
  async function run(action:()=>Promise<void>){setPending(true);setError('');try{await action();}catch(error:any){setError(error.message);onError(error.message);}finally{setPending(false);}}
  return <><button onClick={()=>{setOpen(true);setTarget(null);setReview(null);setSaved(null);setPublication(null);setPublished(false);setError('');}}>替换工作稿引用</button>{open&&<Dialog label="替换媒体引用" dismissible={!pending} onClose={()=>setOpen(false)}>
    <div className="modal-title"><h2>替换媒体引用</h2><button disabled={pending} onClick={()=>setOpen(false)}>关闭</button></div><p>替换文章、笔记和页面工作稿里的引用。历史版本及原文件保留。</p>
    {!saved&&<button disabled={pending} onClick={()=>void run(async()=>{const selected=await selectors.media(mediaKind(url));if(selected){setTarget(selected);setReview(null);}})}>选择替换媒体</button>}
    {target&&<p>{url} → {target.url}</p>}
    {target&&!saved&&<button disabled={pending} onClick={()=>void run(async()=>setReview(await api('media/replace/preview',{fromId:id,toId:target.id})))}>检查影响</button>}
    {review&&!saved&&<><p>影响 {review.items.length} 篇内容</p><ul>{review.items.map(item=><li key={item.id}>{item.title} · {item.count} 处</li>)}</ul><button disabled={pending||!review.items.length} onClick={()=>void run(async()=>setSaved(await api('media/replace/apply',{fromId:id,toId:target!.id,review:review.review})))}>确认保存为工作稿</button></>}
    {saved&&!published&&<><p>已更新 {saved.items.length} 篇工作稿，公开内容尚未变化。</p><button disabled={pending} onClick={()=>void run(async()=>setPublication(await api('publication',{ids:saved.items.map(item=>item.id),revisions:Object.fromEntries(saved.items.map(item=>[item.id,item.revision]))})))}>查看发布变更</button></>}
    {publication&&!published&&<><ul>{publication.entries.map(item=><li key={item.id}>{item.title} · {item.action==='add'?'新增公开内容':'更新公开内容'}</li>)}</ul><button disabled={pending} onClick={()=>void run(async()=>{await waitJob(await api('publish',publication.options),()=>{});setPublished(true);})}>确认发布这批修改</button></>}
    {published&&<p role="status">这批修改已发布。</p>}{error&&<p role="alert">{error}</p>}{pending&&<p role="status">正在处理…</p>}
  </Dialog>}</>;
}
