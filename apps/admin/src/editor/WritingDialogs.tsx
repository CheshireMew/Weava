import {lazy, Suspense, useEffect, useState} from 'react';
import {Dialog} from '../Dialog.tsx';
import {LoadingState} from '../LoadingState.tsx';
import {useSelectors} from '../Selectors.tsx';
import {api} from '../api.ts';
import type {WritingSnippet} from '@weava/contracts';
import {createPortal} from 'react-dom';
const Editor = lazy(() => import('../Editor.tsx').then(module => ({default: module.Editor})));
export type WritingInsert = 'button' | 'footnote' | 'details';
export function WritingInsertDialog({kind, selected = '', onInsert, onClose}: {kind: WritingInsert; selected?: string; onInsert: (value: {title: string; url: string; source: string}) => void; onClose: () => void}) {
  const selectors = useSelectors(), [title, setTitle] = useState(kind === 'details' ? '展开补充内容' : selected), [url, setUrl] = useState(''), [source, setSource] = useState(''), [error, setError] = useState('');
  const label = {button: '插入链接按钮', footnote: '插入脚注', details: '插入折叠内容'}[kind];
  return createPortal(<Dialog label={label} onClose={onClose}><form onSubmit={event => {event.preventDefault(); event.stopPropagation(); onInsert({title, url, source});}}>
    <h2>{label}</h2>
    {kind !== 'footnote' && <label>{kind === 'button' ? '按钮文字' : '折叠标题'}<input data-autofocus required value={title} onChange={event => setTitle(event.target.value)}/></label>}
    {kind === 'button' && <label>网址<input required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…"/></label>}
    {kind === 'footnote' && <Suspense fallback={<LoadingState/>}><Editor compact snippets={false} value={{version: 1, format: 'markdown', source}} onChange={value => setSource(String(value.source))} onMedia={() => selectors.media()} onError={setError}/></Suspense>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions">{kind === 'button' && <button type="button" onClick={() => {void selectors.content().then(content => {if (content) {setUrl('entry:' + encodeURIComponent(content.id)); if (!title) setTitle(content.title);}}).catch(error => setError(error.message));}}>链接到内容</button>}
      <button type="button" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={kind === 'footnote' && !source.trim()}>插入</button></div>
  </form></Dialog>, document.body);
}
type SnippetRecord = {id: string; revision: number; value: WritingSnippet};
export function SnippetsDialog({onInsert, onClose}: {onInsert: (source: string) => void; onClose: () => void}) {
  const selectors = useSelectors(), [rows, setRows] = useState<SnippetRecord[] | null>(null), [draft, setDraft] = useState<SnippetRecord | null>(null), [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api('authoring/snippets').then(setRows).catch(error => setError(error.message));
  useEffect(() => {void load();}, []);
  async function save(archived = false) {
    if (!draft) return;
    setBusy(true); setError('');
    try {await api('authoring/snippets', {value: {...draft.value, archived}, revision: draft.revision || null}); await load(); setDraft(null);}
    catch (error: any) {setError(error.message);} finally {setBusy(false);}
  }
  return createPortal(<Dialog label="常用内容" onClose={busy ? () => {} : onClose} className="modal writing-snippets-dialog"><div className="modal-title"><h2>常用内容</h2><button type="button" disabled={busy} onClick={onClose}>关闭</button></div>
    {draft ? <form onSubmit={event => {event.preventDefault(); event.stopPropagation(); void save();}}>
      <label>名称<input data-autofocus required maxLength={80} value={draft.value.name} onChange={event => setDraft({...draft, value: {...draft.value, name: event.target.value}})}/></label>
      <Suspense fallback={<LoadingState/>}><Editor key={draft.id} snippets={false} value={{version: 1, format: 'markdown', source: draft.value.source}} onChange={value => setDraft(current => current && ({...current, value: {...current.value, source: String(value.source)}}))} onMedia={() => selectors.media()} onError={setError}/></Suspense>
      <div className="dialog-actions">{!!draft.revision && <button type="button" disabled={busy} onClick={() => void save(!draft.value.archived)}>{draft.value.archived ? '恢复' : '归档'}</button>}<button type="button" disabled={busy} onClick={() => setDraft(null)}>返回</button><button className="primary" disabled={busy || !draft.value.name.trim()} type="submit">{busy ? '保存中…' : '保存'}</button></div>
    </form> : <><div className="writing-snippet-search"><input aria-label="搜索常用内容" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)}/><button type="button" onClick={() => {const id = crypto.randomUUID(); setDraft({id, revision: 0, value: {id, name: '', source: '', archived: false}});}}>新建</button></div>
      {rows ? <div className="writing-snippet-list">{rows.filter(row => (!row.value.archived || query) && row.value.name.includes(query)).map(row => <div key={row.id}><span>{row.value.name}{row.value.archived && '（已归档）'}</span><button type="button" onClick={() => setDraft(structuredClone(row))}>编辑</button><button type="button" disabled={row.value.archived} onClick={() => {onInsert(row.value.source); onClose();}}>插入</button></div>)}{!rows.length && <p>还没有常用内容。</p>}</div> : <LoadingState/>}</>}
    {error && <p role="alert">{error}</p>}
  </Dialog>, document.body);
}
