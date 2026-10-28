import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, waitJob } from './api.ts';

export interface SelectedMedia { id: string; url: string; name: string; alt?: string; caption?: string; kind: 'image' | 'video' | 'audio' | 'file' }
export interface SelectedContent { id: string; title: string; path: string }
type Picker = { type: 'media' | 'content'; kind?: string; resolve: (value: any) => void };
const Context = createContext<{ media: (kind?: string) => Promise<SelectedMedia | null>; content: () => Promise<SelectedContent | null> } | null>(null);
export function useSelectors() { const value = useContext(Context); if (!value) throw new Error('Missing selector provider'); return value; }
const kindOf = (url: string): SelectedMedia['kind'] => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url) ? 'image' : /\.(mp4|webm)$/i.test(url) ? 'video' : /\.mp3$/i.test(url) ? 'audio' : 'file';

export function SelectorsProvider({ children }: { children: ReactNode }) {
  const [picker, setPicker] = useState<Picker | null>(null), [q, setQ] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<any>({ items: [], total: 0, pages: 0 }), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const previousFocus = useRef<HTMLElement | null>(null), dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<Picker | null>(null);
  const open = (type: Picker['type'], kind?: string) => new Promise<any>((resolve) => {
    pending.current?.resolve(null); previousFocus.current = document.activeElement as HTMLElement;
    const next = { type, kind, resolve }; pending.current = next; setPicker(next); setQ(''); setPage(1); setError('');
  });
  const finish = (value: any) => { picker?.resolve(value); pending.current = null; setPicker(null); previousFocus.current?.focus(); };
  const refresh = async () => {
    if (!picker) return;
    const params = new URLSearchParams({ q, page: String(page), pageSize: '18', ...(picker.kind ? { kind: picker.kind } : {}) });
    setResult(await api((picker.type === 'media' ? 'media/query?' : 'entries/query?') + params));
  };
  useEffect(() => {
    if (!picker) return;
    let active = true;
    const params = new URLSearchParams({ q, page: String(page), pageSize: '18', ...(picker.kind ? { kind: picker.kind } : {}) });
    api((picker.type === 'media' ? 'media/query?' : 'entries/query?') + params).then((data) => { if (active) setResult(data); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [picker, q, page]);
  useEffect(() => { if (picker && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [picker]);
  async function upload(file: File) {
    setError(''); setProgress('读取文件…');
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await new Promise<any>((resolve, reject) => {
        const request = new XMLHttpRequest(); request.open('POST', '/api/admin/v1/media'); request.setRequestHeader('Content-Type', 'application/json'); request.setRequestHeader('Idempotency-Key', crypto.randomUUID());
        request.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(`上传 ${Math.round(event.loaded / event.total * 100)}%`); };
        request.onerror = () => reject(new Error('上传连接中断。'));
        request.onload = () => { try { const data = JSON.parse(request.responseText); if (request.status >= 400) reject(new Error(data.error)); else resolve(data); } catch (error) { reject(error); } };
        request.send(JSON.stringify({ name: file.name, base64 }));
      });
      await waitJob(response, (job) => setProgress(job.message)); await refresh();
    } catch (error: any) { setError(error.message ?? '上传失败。'); } finally { setProgress(''); }
  }
  return <Context.Provider value={{ media: (kind) => open('media', kind), content: () => open('content') }}>{children}
    {picker && <dialog ref={dialog} className="asset-dialog" onCancel={(event) => { event.preventDefault(); finish(null); }}>
      <div className="modal-title"><h2>{picker.type === 'media' ? '选择媒体' : '选择内容'}</h2><button disabled={!!progress} onClick={() => finish(null)}>关闭</button></div>
      <div className="selector-toolbar"><input autoFocus aria-label={picker.type === 'media' ? '搜索媒体' : '查找内容'} placeholder="搜索" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} />
        {picker.type === 'media' && <label className="button">上传文件<input type="file" hidden disabled={!!progress} accept={picker.kind === 'image' ? 'image/*' : undefined} onChange={(event) => { if (event.target.files?.[0]) void upload(event.target.files[0]); }} /></label>}
      </div>
      {error && <p role="alert">{error}</p>}{progress && <p role="status">{progress}</p>}
      <div className={picker.type === 'media' ? 'selector-media' : 'selector-content'}>
        {result.items.map((row: any) => <button key={row.id} className="selector-item" disabled={!!progress} onClick={() => finish(picker.type === 'media' ? { ...row.value, kind: kindOf(row.value.url) } : { id: row.id, title: row.value.title, path: row.value.path })}>
          {picker.type === 'media' && kindOf(row.value.url) === 'image' && <img src={row.value.derivatives?.[0]?.url ?? row.value.url} alt="" loading="lazy" />}
          <strong>{row.value.name ?? row.value.title}</strong>{picker.type === 'content' && <small>{row.value.path}</small>}
        </button>)}
      </div>
      {!result.total && <p>没有匹配的内容。</p>}
      {result.pages > 1 && <nav className="library-pagination"><button disabled={page <= 1} onClick={() => setPage((page) => page - 1)}>上一页</button><span>{page} / {result.pages}</span><button disabled={page >= result.pages} onClick={() => setPage((page) => page + 1)}>下一页</button></nav>}
    </dialog>}
  </Context.Provider>;
}
