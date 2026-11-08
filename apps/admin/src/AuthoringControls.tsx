import { useState } from 'react';
import type { ContentView, CreationTemplate, Entry, Revision } from '@weava/contracts';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';

export function SavedViewControls({ views, query, apply, refresh, onError }: {
  views: Revision<ContentView>[]; query: ContentView['query']; apply: (query: ContentView['query']) => void;
  refresh: () => Promise<void>; onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState(''), [editing, setEditing] = useState(false), [name, setName] = useState(''), [archived, setArchived] = useState(false);
  const rows = views.filter((row) => row.value.query.kind === query.kind && row.value.archived === archived), row = views.find((row) => row.id === selected);
  const save = async () => { try { const value = { id: row?.id ?? crypto.randomUUID(), name, query, archived: false }; const saved = await api('authoring/views', { value, revision: row?.revision ?? null }); setSelected(saved.id); await refresh(); setEditing(false); } catch (error: any) { onError(error.message); } };
  return <div className="saved-view-controls"><select aria-label="常用筛选" value={rows.some((row) => row.id === selected) ? selected : ''} onChange={(event) => { setSelected(event.target.value); const row = rows.find((row) => row.id === event.target.value); if (row && !row.value.archived) apply(row.value.query); }}><option value="">常用筛选</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.value.name}</option>)}</select>
    <button type="button" aria-label="保存当前筛选" onClick={() => { setName(row?.value.name ?? ''); setEditing(true); }}>保存</button>
    {row && <><button type="button" aria-label="另存筛选" onClick={() => { setSelected(''); setName(''); setEditing(true); }}>另存</button><button type="button" onClick={async () => { try { await api('authoring/views', { value: { ...row.value, archived: !row.value.archived }, revision: row.revision }); setSelected(''); await refresh(); } catch (error: any) { onError(error.message); } }}>{row.value.archived ? '恢复' : '归档'}</button></>}
    {views.some((row) => row.value.archived && row.value.query.kind === query.kind) && <label><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setSelected(''); }} />显示归档</label>}
    {editing && <Dialog label="保存筛选" onClose={() => setEditing(false)}><h2>保存筛选</h2><label>名称<input data-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label><div className="dialog-actions"><button type="button" disabled={!name.trim()} onClick={save}>保存筛选</button><button type="button" onClick={() => setEditing(false)}>取消</button></div></Dialog>}
  </div>;
}
