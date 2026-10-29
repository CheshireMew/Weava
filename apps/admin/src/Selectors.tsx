import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, waitJob } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { useDebouncedValue } from './useDebouncedValue.ts';

export interface SelectedMedia { id: string; url: string; name: string; alt?: string; caption?: string; kind: 'image' | 'video' | 'audio' | 'file' }
export interface SelectedContent { id: string; title: string; path: string }

type Picker = { type: 'media' | 'content'; kind?: string; resolve: (value: any) => void };
const Context = createContext<{ media: (kind?: string) => Promise<SelectedMedia | null>; content: () => Promise<SelectedContent | null> } | null>(null);
export function useSelectors() { const value = useContext(Context); if (!value) throw new Error('Missing selector provider'); return value; }
const kindOf = (url: string): SelectedMedia['kind'] => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url) ? 'image' : /\.(mp4|webm)$/i.test(url) ? 'video' : /\.mp3$/i.test(url) ? 'audio' : 'file';

export function SelectorsProvider({ children }: { children: ReactNode }) {
  const [picker, setPicker] = useState<Picker | null>(null), [q, setQ] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<any>({ items: [], total: 0, pages: 0 }), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const searchTerm = useDebouncedValue(q);
  const fileInput = useRef<HTMLInputElement>(null), pending = useRef<Picker | null>(null);
  useEffect(() => () => { pending.current?.resolve(null); }, []);
  const open = (type: Picker['type'], kind?: string) => new Promise<any>((resolve) => {
    pending.current?.resolve(null);
    const next = { type, kind, resolve };
    pending.current = next; setPicker(next); setQ(''); setPage(1); setError(''); setLoading(true);
    setResult({ items: [], total: 0, pages: 0 });
  });
  const finish = (value: any) => { pending.current?.resolve(value); pending.current = null; setPicker(null); };
  const params = () => new URLSearchParams({ q: searchTerm, page: String(page), pageSize: '18', ...(picker?.kind ? { kind: picker.kind } : {}) });
  useEffect(() => {
    if (!picker) return;
    let active = true;
    setLoading(true); setError('');
    api((picker.type === 'media' ? 'media/query?' : 'entries/query?') + params())
      .then((data) => { if (active) setResult(data); })
      .catch((error) => { if (active) { setError(error.message); setResult({ items: [], total: 0, pages: 0 }); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [picker, searchTerm, page, epoch]);
  async function upload(file: File) {
    setError(''); setProgress('读取文件…');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('无法读取文件，请重新选择。'));
        reader.readAsDataURL(file);
      });
      const response = await new Promise<any>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', '/api/admin/v1/media'); request.setRequestHeader('Content-Type', 'application/json'); request.setRequestHeader('Idempotency-Key', crypto.randomUUID());
        request.timeout = 120000;
        request.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(`上传 ${Math.round(event.loaded / event.total * 100)}%`); };
        request.onerror = () => reject(new Error('上传连接中断，请检查网络后重试。'));
        request.ontimeout = () => reject(new Error('上传超时，请检查网络后重试。'));
        request.onload = () => {
          try { const data = JSON.parse(request.responseText); if (request.status >= 400) reject(new Error(data.error ?? '上传失败，请重试。')); else resolve(data); }
          catch { reject(new Error('网站未返回有效的上传结果，请稍后重试。')); }
        };
        request.send(JSON.stringify({ name: file.name, base64 }));
      });
      await waitJob(response, (job) => setProgress(job.message));
      setQ(''); setPage(1); setEpoch((value) => value + 1);
    } catch (error: any) { setError(error.message ?? '上传失败，请重试。'); }
    finally { setProgress(''); if (fileInput.current) fileInput.current.value = ''; }
  }
  const title = picker?.type === 'media' ? '选择媒体' : '选择内容';
  return <Context.Provider value={{ media: (kind) => open('media', kind), content: () => open('content') }}>{children}
    {picker && <Dialog className="asset-dialog" label={title} onClose={() => finish(null)} dismissible={!progress}>
      <div className="modal-title"><h2>{title}</h2><button disabled={!!progress} onClick={() => finish(null)}>关闭</button></div>
      <div className="selector-toolbar">
        <input data-autofocus aria-label={picker.type === 'media' ? '搜索媒体' : '查找内容'} placeholder="搜索" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} />
        {picker.type === 'media' && <><button disabled={!!progress} onClick={() => fileInput.current?.click()}>上传文件</button><input ref={fileInput} type="file" hidden accept={picker.kind === 'image' ? 'image/*' : undefined} onChange={(event) => { if (event.target.files?.[0]) void upload(event.target.files[0]); }} /></>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}{progress && <p role="status">{progress}</p>}
      {loading && <p role="status">正在查找…</p>}
      <div className={picker.type === 'media' ? 'selector-media' : 'selector-content'} aria-busy={loading}>
        {result.items.map((row: any) => <button key={row.id} className="selector-item" disabled={!!progress || loading} onClick={() => finish(picker.type === 'media' ? { ...row.value, kind: kindOf(row.value.url) } : { id: row.id, title: row.value.title, path: row.value.path })}>
          {picker.type === 'media' && kindOf(row.value.url) === 'image' && <img src={row.value.derivatives?.[0]?.url ?? row.value.url} alt="" loading="lazy" width="240" height="160" />}
          <strong>{row.value.name ?? row.value.title}</strong>{picker.type === 'content' && <small>{row.value.path}</small>}
        </button>)}
      </div>
      {!loading && !error && !result.total && <p role="status">{q ? '没有匹配的内容，请换个关键词。' : picker.type === 'media' ? '媒体库还是空的，可以上传第一个文件。' : '还没有可以引用的内容。'}</p>}
      {result.pages > 1 && <nav className="library-pagination" aria-label={title + '分页'}><button disabled={loading || page <= 1} onClick={() => setPage((page) => page - 1)}>上一页</button><span>{page} / {result.pages}</span><button disabled={loading || page >= result.pages} onClick={() => setPage((page) => page + 1)}>下一页</button></nav>}
    </Dialog>}
  </Context.Provider>;
}
