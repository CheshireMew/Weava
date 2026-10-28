import { useEffect, useState } from 'react';
import type { ArticleComment } from '@weava/core';
import { api } from './api.ts';

type Row = ArticleComment & { title: string; path: string };
export default function Comments({ onError }: { onError: (message: string) => void }) {
  const [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api(`comments?status=${status}&page=${page}`).then(setData);
  useEffect(() => {
    let active = true;
    setData(null);
    api(`comments?status=${status}&page=${page}`).then((result) => { if (active) setData(result); }).catch((error) => onError(error.message));
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
        <option value="all">全部</option><option value="visible">已显示</option><option value="hidden">已隐藏</option>
      </select>
    </div>
    {data ? <>
      {!data.items.length && <p className="muted">暂无评论</p>}
      {data.items.map((row) => <article className="admin-comment form-card" key={row.id}>
        <header><strong>{row.author}</strong><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('zh-CN')}</time><span>{row.status === 'visible' ? '已显示' : '已隐藏'}</span></header>
        {row.path ? <a href={row.path + '#comments'} target="_blank" rel="noreferrer">{row.title}</a> : <span>{row.title}</span>}
        <p>{row.body}</p>
        <button disabled={busy} onClick={() => moderate(row)}>{row.status === 'visible' ? '隐藏评论' : '恢复显示'}</button>
      </article>)}
      <nav className="comment-pagination" aria-label="评论分页">
        <button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={!data.hasMore || busy} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>
    </> : <p>加载中…</p>}
  </div>;
}
