import { useEffect, useState } from 'react';
import type { ArticleComment } from '@weava/core';
import { api } from './api.ts';
import { CommentSettings, type SiteSettingProps } from './SiteSettingControls.tsx';

type Row = ArticleComment & { title: string; path: string };
export default function Comments(props: SiteSettingProps) {
  const { onError } = props;
  const [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reply,setReply]=useState<{parentId:string;body:string;clientId:string}|null>(null);
  const refresh = () => api(`comments?status=${status}&page=${page}`).then(result => { setData(result); setLoadError(''); });
  useEffect(() => {
    let active = true;
    setData(null);
    setLoadError('');
    api(`comments?status=${status}&page=${page}`).then((result) => { if (active) setData(result); }).catch((error) => { if (active) { setLoadError(error.message); onError(error.message); } });
    return () => { active = false; };
  }, [status, page]);
  async function moderate(row: Row) {
    setBusy(true);
    try {
      await api('comment', { id: row.id, status: row.status === 'visible' ? 'hidden' : 'visible' });
      await refresh();
    } catch (error: any) { onError(error.message); }
    finally { setBusy(false); }
  }
  return <div className="panel comments-panel">
    <div className="panel-title"><h1>评论{data ? ` · ${data.total}` : ''}</h1>
      <select aria-label="评论状态" value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
        <option value="all">全部</option><option value="visible">已显示</option><option value="hidden">已隐藏</option><option value="pending">待审核</option>
      </select>
      <CommentSettings {...props} />
    </div>
    {data ? <>
      {!data.items.length && <p className="muted">暂无评论</p>}
      {data.items.map((row) => <article className="admin-comment form-card" key={row.id}>
        <header><strong>{row.author}</strong>{row.isOwner&&<span className="comment-owner">站主</span>}<time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('zh-CN')}</time><span>{row.status === 'pending' ? '待审核' : row.status === 'visible' ? '已显示' : '已隐藏'}</span></header>
        {row.path ? <a href={row.path + '#comments'} target="_blank" rel="noreferrer">{row.title}</a> : <span>{row.title}</span>}
        <p>{row.body}</p>
        {row.replyTo&&<p>回复 {row.replyTo}</p>}
        <button disabled={busy} onClick={() => moderate(row)}>{row.status === 'pending' ? '通过审核' : row.status === 'visible' ? '隐藏评论' : '恢复显示'}</button>
        {row.status==='visible'&&<button disabled={busy} onClick={()=>setReply({parentId:row.id,body:'',clientId:crypto.randomUUID()})}>回复</button>}
        {reply?.parentId===row.id&&<form onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);try{await api('comment/reply',reply);setReply(null);await refresh();}catch(error:any){onError(error.message);}finally{setBusy(false);}}}><label>回复 {row.author}<textarea required maxLength={4000} value={reply.body} onChange={event=>setReply({...reply,body:event.target.value,clientId:crypto.randomUUID()})}/></label><button disabled={busy}>发布回复</button><button type="button" disabled={busy} onClick={()=>setReply(null)}>取消</button></form>}
      </article>)}
      <nav className="comment-pagination" aria-label="评论分页">
        <button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={!data.hasMore || busy} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>
    </> : loadError ? <div className="panel-state" role="alert"><p>评论未能载入。</p><button onClick={() => refresh().catch(error => { setLoadError(error.message); onError(error.message); })}>重新读取评论</button></div> : <p role="status">正在读取评论…</p>}
  </div>;
}
