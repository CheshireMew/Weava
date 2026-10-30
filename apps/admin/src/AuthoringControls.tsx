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
    {editing && <Dialog label="保存筛选" onClose={() => setEditing(false)}><h2>保存筛选</h2><label>名称<input data-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label><button type="button" disabled={!name.trim()} onClick={save}>保存筛选</button><button type="button" onClick={() => setEditing(false)}>取消</button></Dialog>}
  </div>;
}

export function SaveCreationTemplate({ entry, onSaved, onError }: { entry: Entry; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState('');
  return <><button type="button" onClick={() => { setName(entry.title); setOpen(true); }}>保存为新建模板</button>{open && <Dialog label="保存新建模板" onClose={() => setOpen(false)}><h2>保存新建模板</h2><label>模板名称<input data-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label><button type="button" disabled={!name.trim()} onClick={async () => {
    try { const { title, description, summaryMode, allowComments, editorial, documentation, author, cover, categories, tags, termIds, fields, document, blocks, template, seo, visibility, indexable } = entry;
      await api('authoring/templates', { value: { id: crypto.randomUUID(), name, kind: entry.kind, type: entry.type, initial: { title, description, summaryMode, allowComments, editorial, documentation, author, cover, categories, tags, termIds, fields, document, blocks, template, seo, visibility, indexable } }, revision: null }); await onSaved(); setOpen(false);
    } catch (error: any) { onError(error.message); }
  }}>保存模板</button><button type="button" onClick={() => setOpen(false)}>取消</button></Dialog>}</>;
}

export function ChooseCreationTemplate({ templates, kind, type, create, close, refresh, onError }: {
  templates: Revision<CreationTemplate>[]; kind: Entry['kind']; type: string; create: (templateId?: string) => Promise<void>;
  close: () => void; refresh: () => Promise<void>; onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState(''), [archived, setArchived] = useState(false), [busy, setBusy] = useState(false);
  const rows = templates.filter((row) => row.value.kind === kind && (kind === 'page' || row.value.type === type) && row.value.archived === archived), row = rows.find((row) => row.id === selected);
  return <Dialog label="新建内容" onClose={close} dismissible={!busy}><h2>新建内容</h2><label>新建模板<select data-autofocus value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">空白内容</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.value.name}</option>)}</select></label>
    <div className="inline"><button type="button" disabled={busy || archived && !!row} onClick={async () => { setBusy(true); try { await create(selected || undefined); close(); } catch (error: any) { onError(error.message); } finally { setBusy(false); } }}>新建</button><button type="button" disabled={busy} onClick={close}>取消</button>{row && <button type="button" disabled={busy} onClick={async () => { try { await api('authoring/templates', { value: { ...row.value, archived: !row.value.archived }, revision: row.revision }); setSelected(''); await refresh(); } catch (error: any) { onError(error.message); } }}>{archived ? '恢复模板' : '归档模板'}</button>}</div>
    {templates.some((row) => row.value.archived) && <label><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setSelected(''); }} />显示归档</label>}
  </Dialog>;
}
