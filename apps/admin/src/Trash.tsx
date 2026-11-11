import {useState,useEffect} from 'react';
import {Search,RefreshCw} from 'lucide-react';
import {LoadingState} from './LoadingState.tsx';
import {useAdminQuery} from './useAdminQuery.ts';
import {useDebouncedValue} from './useDebouncedValue.ts';
import {api} from './api.ts';
import type {ApiOutput} from '@weava/contracts/api';
export default function TrashPanel(){
  const [page,setPage]=useState(1),[filter,setFilter]=useState(''),[pending,setPending]=useState<{id:string;action:'restore'|'purge'}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const search=useDebouncedValue(filter),query=useAdminQuery<ApiOutput<'trash'>>('entries/trash?'+new URLSearchParams({page:String(page),q:search}));
  useEffect(()=>setPage(1),[search]);
  useEffect(()=>{if(query.data&&page>Math.max(1,query.data.pages))setPage(Math.max(1,query.data.pages));},[query.data,page]);
  async function action(path:'restore'|'purge',row:ApiOutput<'trash'>['items'][number]) {
    if(pending)return;
    setPending({id:row.id,action:path});setError('');setMessage('');
    try {
      if(path==='restore')await api('entries/trash/restore',{id:row.id,revision:row.revision});
      else await api('entries/trash/purge',{id:row.id,revision:row.revision,confirmation:'永久删除'});
      setMessage('“'+row.title+'”'+(path==='purge'?'已永久删除':'已恢复为草稿'));
      await query.refresh();
    } catch(error:any) {setError(error.message);}
    finally {setPending(null);}
  }
  return <section className="panel trash-panel" aria-label="回收站">
    <div className="panel-title"><h1>回收站</h1><button disabled={!!pending||query.loading} onClick={()=>void query.refresh().catch(error=>setError(error.message))}><RefreshCw size={17} aria-hidden="true"/>刷新</button></div>
    <div className="trash-tools"><Search size={19} aria-hidden="true"/><input type="search" aria-label="搜索回收站" placeholder="搜索标题" value={filter} onChange={event=>setFilter(event.target.value)}/></div>
    {(error||query.error)&&<p role="alert">{error||query.error}<button onClick={()=>void query.refresh().catch(error=>setError(error.message))}>重新读取</button></p>}
    {message&&<p className="trash-feedback" role="status">{message}</p>}
    <div className="trash-list" aria-busy={query.loading}>
      {query.loading&&!query.data&&<LoadingState label="读取回收站"/>}
      {query.data?.items.map(row=><article key={row.id} className="trash-row"><div className="trash-copy"><h2>{row.title}</h2><p>{row.path}</p><time dateTime={row.deletedAt}>{new Date(row.deletedAt).toLocaleString('zh-CN',{dateStyle:'medium',timeStyle:'short'})}</time></div><div className="trash-actions"><button disabled={!!pending} onClick={()=>void action('restore',row)}>{pending?.id===row.id&&pending.action==='restore'?'正在恢复…':'恢复为草稿'}</button><button className="trash-purge" disabled={!!pending} onClick={()=>void action('purge',row)}>{pending?.id===row.id&&pending.action==='purge'?'正在删除…':'永久删除'}</button></div></article>)}
      {query.data&&!query.data.items.length&&<p className="library-status">{filter?'没有找到匹配的内容。':'回收站是空的。'}</p>}
    </div>
    {query.data&&<nav className="library-pagination" aria-label="回收站分页"><span>共 {query.data.total} 项</span>{query.data.pages>1&&<div className="pagination-buttons"><button disabled={page<=1||!!pending} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {query.data.pages}</span><button disabled={page>=query.data.pages||!!pending} onClick={()=>setPage(page+1)}>下一页</button></div>}</nav>}
  </section>;
}
