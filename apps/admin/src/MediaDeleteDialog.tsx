import {useEffect, useState} from 'react';
import {api} from './api.ts';
import {Dialog} from './Dialog.tsx';
import type {MediaRecord} from './media-models.ts';

export function MediaDeleteDialog({row, onClose, onDelete}: {
  row: MediaRecord;
  onClose: () => void;
  onDelete: (row: MediaRecord) => Promise<void>;
}) {
  const [review, setReview] = useState<{blocked: string | null} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(`media/delete/preview?id=${encodeURIComponent(row.id)}`).then(
      result => { if (active) setReview(result); },
      error => { if (active) setError(error.message); },
    );
    return () => { active = false; };
  }, [row.id]);

  async function remove() {
    if (busy || !review || review.blocked) return;
    setBusy(true);
    setError('');
    try { await onDelete(row); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <Dialog label="删除媒体" className="modal entry-delete-dialog" onClose={onClose} dismissible={!busy}>
    <h2>删除「{row.value.name}」？</h2>
    {error ? <p role="alert" className="error">{error}</p>
      : review?.blocked ? <p role="status">{review.blocked}</p>
      : review ? <p>将永久删除文件及其独有的图片副本，无法撤销。</p>
      : <p role="status">正在检查媒体引用…</p>}
    <div className="entry-delete-actions">
      <button type="button" data-autofocus disabled={busy} onClick={onClose}>{review?.blocked ? '关闭' : '取消'}</button>
      {review && !review.blocked && <button type="button" className="publication-delete-confirm" disabled={busy} onClick={() => void remove()}>
        {busy ? '正在删除…' : '永久删除'}
      </button>}
    </div>
  </Dialog>;
}
