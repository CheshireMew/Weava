import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';

export function JobLogs({ id, onClose }: { id: string; onClose(): void }) {
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<{ text: string; start: number; end: number; total: number } | null>(null);
  const [pending, setPending] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPending(true); setError('');
    api(`logs?id=${encodeURIComponent(id)}&offset=${offset}`).then((value) => {
      if (active) setPage(value);
    }).catch((error) => { if (active) setError(error.message); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [id, offset, refresh]);
  return <Dialog label="任务日志" className="modal job-logs" onClose={onClose}>
    <div className="panel-title"><h2>任务日志</h2><button data-autofocus onClick={onClose}>关闭</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <pre tabIndex={0} aria-label="日志内容" aria-busy={pending}>{page?.text || (pending ? '正在读取…' : '暂无日志')}</pre>
    <div className="job-log-controls">
      <span aria-live="polite">{page ? `${page.start}—${page.end} / ${page.total}` : ''}</span>
      <button disabled={pending || !page || page.start === 0} onClick={() => setOffset(Math.max(0, Math.floor(page!.start / 20000 - 1) * 20000))}>上一页</button>
      <button disabled={pending || !page || page.end >= page.total} onClick={() => setOffset(page!.end)}>下一页</button>
      <button disabled={pending || !page || page.end >= page.total} onClick={() => setOffset(Math.floor((page!.total - 1) / 20000) * 20000)}>末页</button>
      <button disabled={pending} onClick={() => setRefresh((value) => value + 1)}>刷新</button>
    </div>
  </Dialog>;
}
