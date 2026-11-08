import { useEffect, useState } from 'react';
import type { ArticleComment } from '@weava/core';
import { api } from './api.ts';
import { useAdminQuery } from './useAdminQuery.ts';
import { CommentSettings, type SiteSettingProps } from './SiteSettingControls.tsx';
import { useManagedRecord, useEditSessions } from './EditSessions.tsx';
import { watchVisible } from './analytics/polling.ts';
import { LoadingState } from './LoadingState.tsx';

type Row = ArticleComment & { title: string; path: string };
export default function Comments(props: SiteSettingProps) {
  const { onError } = props;
  const [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const query = useAdminQuery<{ items: Row[]; total: number; hasMore: boolean }>(`comments?status=${status}&page=${page}`);
  const data = query.data;
  const [busy, setBusy] = useState(false);
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
  async function moderate(row: Row) {
    setBusy(true);
    try {
      await api('comment', { id: row.id, status: row.status === 'visible' ? 'hidden' : 'visible' });
      await refresh();
    } catch (error: any) { onError(error.message); }
    finally { setBusy(false); }
  }
  const composer=(author:string)=>reply&&<form onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);try{await api('comment/reply',reply);replyEditor.session.discard();setReply(null);await refresh();}catch(error:any){onError(error.message);}finally{setBusy(false);}}}><label>回复 {author}<textarea required disabled={busy} maxLength={4000} value={reply.body} onChange={event=>setReply({...reply,body:event.target.value,clientId:crypto.randomUUID()})}/></label><div className="inline"><button disabled={busy}>发布回复</button><button type="button" disabled={busy} onClick={()=>{replyEditor.session.discard();setReply(null);}}>取消</button></div></form>;
  return <div className="panel comments-panel">
    <div className="panel-title"><h1>评论{data ? ` · ${data.total}` : ''}</h1>
      <button disabled={busy || query.pending} onClick={() => refresh().catch(() => {})}>刷新评论</button>
      <select aria-label="评论状态" value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
        <option value="all">全部</option><option value="visible">已显示</option><option value="hidden">已隐藏</option><option value="pending">待审核</option>
      </select>
      <CommentSettings {...props} />
    </div>
    {reply&&!data?.items.some(row=>row.id===reply.parentId)&&composer('评论')}
    {data ? <>
      {!data.items.length && <p className="muted">暂无评论</p>}
      {data.items.map((row) => <article className="admin-comment form-card" key={row.id}>
        <header><strong>{row.author}</strong>{row.isOwner&&<span className="comment-owner">站主</span>}<time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('zh-CN')}</time><span>{row.status === 'pending' ? '待审核' : row.status === 'visible' ? '已显示' : '已隐藏'}</span></header>
        {row.path ? <a href={row.path + '#comments'} target="_blank" rel="noreferrer">{row.title}</a> : <span>{row.title}</span>}
        <p>{row.body}</p>
        {row.replyTo&&<p>回复 {row.replyTo}</p>}
        <button disabled={busy} onClick={() => moderate(row)}>{row.status === 'pending' ? '通过审核' : row.status === 'visible' ? '隐藏评论' : '恢复显示'}</button>
        {row.status==='visible'&&<button disabled={busy} onClick={async()=>{try{if(reply?.parentId===row.id)return;await editors.flush();replyEditor.session.adopt({id:row.id,revision:null,value:{parentId:row.id,body:'',clientId:crypto.randomUUID()}});}catch(error:any){onError(error.message);}}}>回复</button>}
        {reply?.parentId===row.id&&composer(row.author)}
      </article>)}
      <nav className="comment-pagination" aria-label="评论分页">
        <button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={!data.hasMore || busy} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>
    </> : loadError ? <div className="panel-state" role="alert"><p>评论未能载入。</p><button onClick={() => refresh().catch(error => onError(error.message))}>重新读取评论</button></div> : <LoadingState label="读取评论" />}
  </div>;
}
