import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue.ts';
import { api, waitJob } from './api.ts';
import { useSelectors } from './Selectors.tsx';

export default function MediaManager({ onError, onOpen }: { onError: (message: string) => void; onOpen: (id: string) => void }) {
  const selectors = useSelectors();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [feedback, setFeedback] = useState('');
  const details = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [page, setPage] = useState(1), [archived, setArchived] = useState(false), [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<any>({ items: [], pages: 0, total: 0 }), [selected, setSelected] = useState<any>(null), [checked, setChecked] = useState<string[]>([]);
  const [references, setReferences] = useState<any>(null), [progress, setProgress] = useState('');
  const [crop, setCrop] = useState({ left: 0, top: 0, width: 100, height: 100 }), [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const searchTerm = useDebouncedValue(query);
  const refresh = () => setEpoch((value) => value + 1);
  useEffect(() => { setFeedback(''); }, [searchTerm, kind, page, archived]);
  useEffect(() => {
    let active = true; setLoading(true);
    api('media/query?' + new URLSearchParams({ q: searchTerm, kind, page: String(page), pageSize: '24', archived: String(archived) })).then((data) => { if (active) { setResult(data); setChecked([]); } }).catch((error) => { if (active) onError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [searchTerm, kind, page, archived, epoch]);
  useEffect(() => {
    setReferences(null); setCrop({ left: 0, top: 0, width: 100, height: 100 });
    if (!selected) return;
    if (window.matchMedia('(max-width: 900px)').matches) details.current?.scrollIntoView({ block: 'start' });
    let active = true; api('media/references?id=' + encodeURIComponent(selected.id)).then((value) => { if (active) setReferences(value); }).catch((error) => onError(error.message));
    return () => { active = false; };
  }, [selected?.id]);
  const isImage = selected && /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(selected.value.url);
  const save = async () => {
    if (!selected) return;
    const row = await api('media/info', { id: selected.id, revision: selected.revision, value: { name: selected.value.name, alt: selected.value.alt, caption: selected.value.caption } });
    setSelected(row); refresh(); return row;
  };
  const mark = async () => {
    try { await api('media/archive', { items: result.items.filter((row: any) => checked.includes(row.id)).map((row: any) => ({ id: row.id, revision: row.revision })), archived: !archived }); setSelected(null); refresh(); }
    catch (error: any) { onError(error.message); }
  };
  const point = (event: React.PointerEvent<HTMLElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - box.top) / box.height * 100)) }; };
  return <div className="panel"><div className="panel-title"><h1>媒体</h1><button className="primary" onClick={async () => { await selectors.media(); refresh(); }}>上传或选择媒体</button></div>
    <div className="media-filters"><input aria-label="搜索媒体库" placeholder="搜索媒体" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><select aria-label="媒体类型" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="file">附件</option></select><label className="checkbox"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); }} />已归档</label>{checked.length > 0 && <button onClick={() => void mark()}>{archived ? '恢复所选' : '归档所选'}</button>}</div>
    {feedback && <p role="status">{feedback}</p>}{loading && <p role="status">正在查找媒体…</p>}
    {!loading && !result.total && <p role="status">{query || kind || archived ? '没有符合筛选条件的媒体。' : '媒体库还是空的，可以上传第一个文件。'}</p>}
    <div className="media-workspace"><div><div className="media-grid" aria-busy={loading}>{result.items.map((row: any) => <article key={row.id}><label className="checkbox"><input type="checkbox" aria-label={'选择 ' + row.value.name} checked={checked.includes(row.id)} onChange={(event) => setChecked(event.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))} /></label>
      <button className="media-open" onClick={() => setSelected(row)}>{/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(row.value.url) ? <img src={row.value.derivatives?.[0]?.url ?? row.value.url} alt="" loading="lazy" /> : <span>文件</span>}<strong>{row.value.name}</strong></button>
      <small>{(row.value.bytes / 1024).toFixed(1)} KB</small><button onClick={async () => { try { await navigator.clipboard.writeText(row.value.url); setFeedback('地址已复制'); } catch { onError('无法复制地址，请检查浏览器的剪贴板权限。'); } }}>复制地址</button></article>)}</div>
      {result.pages > 1 && <nav className="library-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {result.pages}</span><button disabled={page >= result.pages} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>}
    </div>{selected && <aside ref={details} className="media-details"><div className="modal-title"><h2>媒体信息</h2><button onClick={() => setSelected(null)}>关闭</button></div><label>名称<input value={selected.value.name} onChange={(event) => setSelected({ ...selected, value: { ...selected.value, name: event.target.value } })} /></label>
      {isImage && <><label>图片说明<input value={selected.value.alt ?? ''} onChange={(event) => setSelected({ ...selected, value: { ...selected.value, alt: event.target.value } })} /></label><label>图注<textarea value={selected.value.caption ?? ''} onChange={(event) => setSelected({ ...selected, value: { ...selected.value, caption: event.target.value } })} /></label></>}
      <button disabled={saving || !!progress} onClick={async () => { setSaving(true); try { await save(); setFeedback('媒体信息已保存'); } catch (error: any) { onError(error.message); } finally { setSaving(false); } }}>{saving ? '正在保存…' : '保存媒体信息'}</button>
      {isImage && <details><summary>裁切副本</summary><div className="crop-surface" onPointerDown={(event) => { const start = point(event); setAnchor(start); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!anchor) return; const end = point(event); setCrop({ left: Math.min(anchor.x, end.x), top: Math.min(anchor.y, end.y), width: Math.max(.1, Math.abs(end.x - anchor.x)), height: Math.max(.1, Math.abs(end.y - anchor.y)) }); }} onPointerUp={() => setAnchor(null)} onPointerCancel={() => setAnchor(null)} onLostPointerCapture={() => setAnchor(null)}><img src={selected.value.url} alt="裁切预览" draggable={false} /><span style={{ left: crop.left + '%', top: crop.top + '%', width: crop.width + '%', height: crop.height + '%' }} /></div>
        <div className="crop-inputs">{(['left', 'top', 'width', 'height'] as const).map((key) => <label key={key}>{({ left: '左边距 %', top: '上边距 %', width: '宽度 %', height: '高度 %' })[key]}<input type="number" min="0" max="100" value={Math.round(crop[key] * 10) / 10} onChange={(event) => setCrop({ ...crop, [key]: Number(event.target.value) })} /></label>)}</div>
        <button disabled={!!progress} onClick={async () => { try { const row = await save(); const job = await api('media/crop', { id: row.id, revision: row.revision, crop }); const complete = await waitJob(job, (job) => setProgress(job.message)); setSelected(complete.result); refresh(); } catch(error: any) { onError(error.message); } finally { setProgress(''); } }}>生成裁切副本</button>{progress && <p role="status">{progress}</p>}
      </details>}
      {references && <section><h3>引用位置</h3>{references.working.map((entry: any) => <button key={entry.id} onClick={() => onOpen(entry.id)}>{entry.title}</button>)}{!references.working.length && <p>当前工作稿未引用</p>}{references.layouts.map((layout: any) => <p key={layout.id}>布局：{layout.label}</p>)}{references.settings && <p>网站设置</p>}<p>公开内容 {references.published.length} · 历史修订 {references.historicalRevisions}</p></section>}
    </aside>}</div>
  </div>;
}
