import { useEffect, useRef, useState } from 'react';
import type { ArticleComment } from '@weava/core';
import { api } from './api.ts';
import { useAdminQuery } from './useAdminQuery.ts';
import { CommentSettings, type SiteSettingProps } from './SiteSettingControls.tsx';
import { useManagedRecord, useEditSessions } from './EditSessions.tsx';
import { watchVisible } from './analytics/polling.ts';
import { LoadingState } from './LoadingState.tsx';
import {useDebouncedValue} from './useDebouncedValue.ts';

type Row = ArticleComment & { title: string; path: string };
export default function Comments(props: SiteSettingProps) {
  const { onError } = props;
  const [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const [filters,setFilters]=useState({q:'',author:'',path:'',start:'',end:''}),[selected,setSelected]=useState<string[]>([]),[bulkBusy,setBulkBusy]=useState(false);
  const search=useDebouncedValue(filters.q);
  const params=new URLSearchParams({status,page:String(page),...filters,q:search});
  const query = useAdminQuery<{ items: Row[]; total: number; hasMore: boolean }>(`comments?${params}`);
  const data = query.data;
  const filterKey=JSON.stringify({...filters,q:search,status,page});
  useEffect(()=>setSelected([]),[filterKey]);
  useEffect(()=>{if(data&&!data.items.length&&data.total>0&&page>1)setPage(Math.max(1,Math.ceil(data.total/30)));},[data,page]);
  async function moderateSelected(status:'visible'|'hidden'){
    const items=data?.items.filter(row=>selected.includes(row.id)).map(row=>({id:row.id,expectedStatus:savedStatuses[row.id]??row.status??'visible'}));
    if(!items?.length)return;setBulkBusy(true);
    try{await api('comments/moderate',{items,status});setSelected([]);await query.refresh();}catch(error:any){onError(error.message);}finally{setBulkBusy(false);}
  }
  const [pending,setPending]=useState<Set<string>>(new Set()),active=useRef(new Set<string>());
  const [replyBusy,setReplyBusy]=useState(false),[savedStatuses,setSavedStatuses]=useState<Record<string,ArticleComment['status']>>({});
  useEffect(()=>setSavedStatuses(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>active.current.has(id)))),[data]);
  const editors=useEditSessions();
  const loadError = query.error;
  const replyEditor=useManagedRecord<{id:string;revision:null;value:{parentId:string;body:string;clientId:string}}>(null,async record=>{
    if(!record.value.body.trim())return record;
    throw new Error('回复尚未发布，请发布后再离开，或明确放弃这份回复。');
  },'评论回复');
  const reply=replyEditor.record?.value??null;
  const setReply=(value:{parentId:string;body:string;clientId:string}|null)=>{
    if(value)replyEditor.setRecord({id:value.parentId,revision:null,value});else replyEditor.session.adopt(null);
  };
  const refresh = () => query.refresh();
  useEffect(() => {
    const watch = watchVisible(() => query.refresh(), () => {}, () => {}, 15000);
    return watch.stop;
  }, [query.refresh]);
  useEffect(() => { if (loadError) onError(loadError); }, [loadError]);
  const refreshAfter=(message:string)=>{void refresh().catch(error=>onError(message+'，列表刷新失败：'+error.message));};
  async function moderate(row:Row){
    if(active.current.has(row.id))return;active.current.add(row.id);setPending(new Set(active.current));
    const next=(savedStatuses[row.id]??row.status)==='visible'?'hidden':'visible';
    try{await api('comment',{id:row.id,status:next});setSavedStatuses(previous=>({...previous,[row.id]:next}));refreshAfter('评论状态已更新');}
    catch(error:any){onError(error.message);}finally{active.current.delete(row.id);setPending(new Set(active.current));}
  }
  const composer=(author:string)=>reply&&<form onSubmit={async event=>{event.preventDefault();if(replyBusy)return;setReplyBusy(true);try{await api('comment/reply',reply);replyEditor.session.discard();setReply(null);refreshAfter('回复已发布');}catch(error:any){onError(error.message);}finally{setReplyBusy(false);}}}><label>回复 {author}<textarea required disabled={replyBusy} maxLength={4000} value={reply.body} onChange={event=>setReply({...reply,body:event.target.value,clientId:crypto.randomUUID()})}/></label><div className="inline"><button disabled={replyBusy}>发布回复</button><button type="button" disabled={replyBusy} onClick={()=>{replyEditor.session.discard();setReply(null);}}>取消</button></div></form>;
  return <div className="panel comments-panel">
    <div className="panel-title"><h1>评论{data ? ` · ${data.total}` : ''}</h1>
      <div className="comment-toolbar">
      <button disabled={query.pending} onClick={() => refresh().catch(() => {})}>刷新评论</button>
      <select aria-label="评论状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
        <option value="all">全部</option><option value="visible">已显示</option><option value="hidden">已隐藏</option><option value="pending">待审核</option>
      </select>
      <CommentSettings {...props} />
      </div>
    </div>
    <div className="comment-filters">{([['q','搜索评论'],['author','评论者称呼'],['path','文章网址'],['start','开始日期（UTC）'],['end','结束日期（UTC）']] as const).map(([key,label])=><label key={key}>{label}<input type={key==='start'||key==='end'?'date':'search'} value={filters[key]} onChange={event=>{setFilters(previous=>({...previous,[key]:event.target.value}));setPage(1);}}/></label>)}</div>
    {data&&data.items.length>0&&<div className="comment-bulk"><label><input type="checkbox" aria-label="全选本页评论" disabled={bulkBusy||query.pending} checked={data.items.every(row=>selected.includes(row.id))} onChange={event=>setSelected(event.target.checked?data.items.map(row=>row.id):[])}/>全选本页</label>{selected.length>0&&<><span>已选 {selected.length} 条</span><button disabled={bulkBusy||query.pending} onClick={()=>void moderateSelected('visible')}>通过所选评论</button><button disabled={bulkBusy||query.pending} onClick={()=>void moderateSelected('hidden')}>隐藏所选评论</button></>}</div>}
    {reply&&!data?.items.some(row=>row.id===reply.parentId)&&composer('评论')}
    {data ? <>
      {!data.items.length && <p className="muted">暂无评论</p>}
      {data.items.map((original) => {const row={...original,status:savedStatuses[original.id]??original.status};return <article className="admin-comment form-card" key={row.id}>
        <label><input type="checkbox" aria-label={'选择 '+row.author+' 的评论'} disabled={bulkBusy||query.pending} checked={selected.includes(row.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/>选择</label>
        <header><strong>{row.author}</strong>{row.isOwner&&<span className="comment-owner">站主</span>}<time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('zh-CN')}</time><span>{row.status === 'pending' ? '待审核' : row.status === 'visible' ? '已显示' : '已隐藏'}</span></header>
        {row.path ? <a href={row.path + '#comments'} target="_blank" rel="noreferrer">{row.title}</a> : <span>{row.title}</span>}
        <p>{row.body}</p>
        {row.replyTo&&<p>回复 {row.replyTo}</p>}
        <button disabled={pending.has(row.id)} onClick={() => moderate(row)}>{row.status === 'pending' ? '通过审核' : row.status === 'visible' ? '隐藏评论' : '恢复显示'}</button>
        {row.status==='visible'&&<button disabled={pending.has(row.id)} onClick={async()=>{try{if(reply?.parentId===row.id)return;await editors.flush();replyEditor.session.adopt({id:row.id,revision:null,value:{parentId:row.id,body:'',clientId:crypto.randomUUID()}});}catch(error:any){onError(error.message);}}}>回复</button>}
        {reply?.parentId===row.id&&composer(row.author)}
      </article>;})}
      <nav className="comment-pagination" aria-label="评论分页">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>
    </> : loadError ? <div className="panel-state" role="alert"><p>评论未能载入。</p><button onClick={() => refresh().catch(error => onError(error.message))}>重新读取评论</button></div> : <LoadingState label="读取评论" />}
  </div>;
}
