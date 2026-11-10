import {useState,useEffect} from 'react';
import {Dialog} from './Dialog.tsx';
import {useAdminQuery} from './useAdminQuery.ts';
import {useDebouncedValue} from './useDebouncedValue.ts';
import {api} from './api.ts';
import type {ApiOutput} from '@weava/contracts/api';
export function Trash(){
  const [open,setOpen]=useState(false),[page,setPage]=useState(1),[filter,setFilter]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [purge,setPurge]=useState<ApiOutput<'trash'>['items'][number]|null>(null),[confirmation,setConfirmation]=useState('');
  const search=useDebouncedValue(filter),query=useAdminQuery<ApiOutput<'trash'>>(open?'entries/trash?'+new URLSearchParams({page:String(page),q:search}):null);
  useEffect(()=>setPage(1),[search]);
  useEffect(()=>{if(query.data&&page>Math.max(1,query.data.pages))setPage(Math.max(1,query.data.pages));},[query.data,page]);
  async function action(path:'restore'|'purge',row:ApiOutput<'trash'>['items'][number]){setPending(true);setError('');try{if(path==='restore')await api('entries/trash/restore',{id:row.id,revision:row.revision});else await api('entries/trash/purge',{id:row.id,revision:row.revision,confirmation:confirmation as '永久删除'});setPurge(null);setConfirmation('');await query.refresh();}catch(error:any){setError(error.message);}finally{setPending(false);}}
  return <><button onClick={()=>setOpen(true)}>回收站</button>{open&&<Dialog label="内容回收站" dismissible={!pending} onClose={()=>{setOpen(false);setPurge(null);setError('');}}>
    <div className="modal-title"><h2>回收站</h2><button disabled={pending} onClick={()=>setOpen(false)}>关闭</button></div>
    <input type="search" aria-label="搜索回收站" placeholder="搜索标题" value={filter} onChange={event=>setFilter(event.target.value)}/>
    {(error||query.error)&&<p role="alert">{error||query.error}<button onClick={()=>void query.refresh().catch(error=>setError(error.message))}>重新读取</button></p>}
    {query.loading&&<p role="status">正在读取…</p>}
    {query.data?.items.map(row=><article key={row.id} className="form-card"><strong>{row.title}</strong><p>{row.path} · {new Date(row.deletedAt).toLocaleString()}</p><button disabled={pending} onClick={()=>void action('restore',row)}>恢复为草稿</button><button disabled={pending} onClick={()=>{setPurge(row);setConfirmation('');}}>永久删除</button></article>)}
    {query.data&&!query.data.items.length&&<p>回收站没有匹配的内容。</p>}
    {query.data&&query.data.pages>1&&<nav aria-label="回收站分页"><button disabled={page<=1||pending} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {query.data.pages}</span><button disabled={page>=query.data.pages||pending} onClick={()=>setPage(page+1)}>下一页</button></nav>}
    {purge&&<section className="form-card"><h3>永久移出“{purge.title}”？</h3><p>此后不能从回收站恢复。历史发布快照和共享媒体继续按各自的保留规则保存。</p><label>输入“永久删除”<input value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label><button disabled={pending||confirmation!=='永久删除'} onClick={()=>void action('purge',purge)}>确认永久删除</button><button disabled={pending} onClick={()=>setPurge(null)}>取消</button></section>}
  </Dialog>}</>;
}
