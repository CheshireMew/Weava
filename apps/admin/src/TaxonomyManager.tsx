import { useState, useEffect } from 'react';
import { AutosaveStatus } from './AutosaveStatus.tsx';
import { Dialog } from './Dialog.tsx';
import { Pencil, Plus } from 'lucide-react';
import type { Term } from '@weava/contracts';
import { api } from './api.ts';
import { termTrail } from './TermPicker.tsx';
import { useManagedRecord } from './EditSessions.tsx';

type TermRecord = { id: string; revision: number | null; value: Term };
export function useTaxonomyEditor(rows: TermRecord[], refresh: () => Promise<any>, apply?: () => void) {
  const [busy, setBusy] = useState(false);
  const [refreshError,setRefreshError]=useState('');
  const reload=()=>refresh().then(()=>setRefreshError(''),error=>setRefreshError('分类与标签已保存，列表刷新失败：'+error.message));
  const managed = useManagedRecord<TermRecord>(null, async record => {
    const label = record.value.label.trim();
    if (!label) throw new Error('请填写分类或标签名称。');
    const slug = record.value.slug.trim() || label.replace(/[/?#\\\s]+/g, '-');
    const saved = await api('terms', { value: { ...record.value, label, slug }, revision: record.revision });
    return saved;
  }, '分类与标签', { saved:()=>{apply?.();void reload();},autosave: { ready: record => !!record.value.label.trim() && !!(record.value.slug.trim() || record.value.label.replace(/[/?#\\\s]+/g, '-')) } });
  useEffect(() => {
    const current = managed.session.record;
    if (current?.revision != null) {
      const latest = rows.find(row => row.id === current.id);
      if (latest) managed.session.receive(latest);
    }
  }, [rows]);
  async function save() {
    setBusy(true);
    try { return await managed.autoSave.flush(); }
    finally { setBusy(false); }
  }
  async function select(record: TermRecord | null) {
    await save();
    managed.session.adopt(record?.revision === null ? null : record);
    if (record?.revision === null) managed.setRecord(record);
  }
  return {
    rows, catalog: rows.map(row => row.value), record: managed.record, busy, autoSave: managed.autoSave,refreshError,reload,
    save, select,
    update: (patch: Partial<Term>) => managed.setRecord(record => record && ({ ...record, value: { ...record.value, ...patch } })),
    cancel: () => { managed.session.discard(); managed.session.adopt(null); },
  };
}

export default function TaxonomyManager({ model, onError }: {
  model: ReturnType<typeof useTaxonomyEditor>; onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<Term['kind']>('category'), [query, setQuery] = useState('');
  const { rows, catalog, record, busy, update } = model;
  const label = kind === 'category' ? '分类' : '标签';
  const run = (action: () => Promise<any>) => { void action().catch(error => onError(error.message)); };
  const descendants = (id: string, parent: string): boolean => {
    const term = catalog.find(term => term.id === id);
    return term?.parentId === parent || !!term?.parentId && descendants(term.parentId, parent);
  };
  const visible = rows.filter(row => row.value.kind === kind && termTrail(row.value, catalog).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => termTrail(a.value, catalog).localeCompare(termTrail(b.value, catalog)));
  const fields = record && <div className="taxonomy-edit-fields">
    <label>名称<input data-autofocus aria-label="分类或标签名称" value={record.value.label} onChange={event => update({ label: event.target.value })} /></label>

      <label>网址标识<input aria-label="分类或标签网址标识" placeholder="根据名称自动生成" value={record.value.slug} onChange={event => update({ slug: event.target.value })} /></label>
      <label>上级{label}<select aria-label={'上级' + label} value={record.value.parentId ?? ''} onChange={event => update({ parentId: event.target.value || undefined })}>
        <option value="">无上级</option>{catalog.filter(term => term.kind === record.value.kind && term.id !== record.id && !descendants(term.id, record.id)).map(term => <option key={term.id} value={term.id}>{termTrail(term, catalog)}</option>)}
      </select></label>

    {['error', 'incomplete'].includes(model.autoSave.phase) && <AutosaveStatus state={model.autoSave} label="分类与标签" />}
    <div className="taxonomy-edit-actions"><button type="button" disabled={busy} onClick={() => run(() => model.select(null))}>完成</button>{record.revision === null && <button type="button" disabled={busy} onClick={model.cancel}>取消新建</button>}</div>
  </div>;
  return <section className="form-card taxonomy-settings" aria-label="分类与标签管理">
    <h2>分类与标签</h2>
    {model.refreshError&&<p role="alert">{model.refreshError}<button onClick={()=>void model.reload()}>重新刷新列表</button></p>}
    <div className="taxonomy-controls"><div className="taxonomy-kinds" role="group" aria-label="分类种类">
      {(['category', 'tag'] as const).map(next => <button key={next} type="button" disabled={busy} aria-pressed={kind === next} onClick={() => run(async () => { await model.select(null); setKind(next); setQuery(''); })}>{next === 'category' ? '分类' : '标签'}</button>)}
    </div><button type="button" disabled={busy} onClick={() => run(async () => {
      const id = 'term-' + crypto.randomUUID();
      await model.select({ id, revision: null, value: { id, kind, label: '', slug: '' } });
    })}><Plus size={15} aria-hidden="true" />新建{label}</button></div>
    <input type="search" aria-label="搜索分类和标签" placeholder={'搜索' + label} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="taxonomy-inline-list">
      {visible.map(row => <button key={row.id} type="button" aria-label={'编辑' + label + ' ' + termTrail(row.value, catalog)} aria-haspopup="dialog" disabled={busy}
        onClick={() => run(() => model.select(record?.id === row.id ? null : row))}><span>{termTrail(row.value, catalog)}</span><Pencil size={14} aria-hidden="true" /></button>)}
      {!visible.length && !record && <p className="muted">{query ? '没有匹配的' + label : '尚未创建' + label}</p>}
    </div>
    {record && <Dialog label={(record.revision === null ? '新建' : '编辑') + label} onClose={() => { if (record.revision === null) model.cancel(); else run(() => model.select(null)); }} dismissible={!busy}>
      <div className="modal-title"><h2>{record.revision === null ? '新建' : '编辑'}{label}</h2><button type="button" disabled={busy} onClick={() => { if (record.revision === null) model.cancel(); else run(() => model.select(null)); }}>关闭</button></div>
      {fields}
    </Dialog>}
  </section>;
}
