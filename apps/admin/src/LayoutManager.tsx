import { useRef, useState, useEffect } from 'react';
import type { Layout } from '@weava/contracts';
import { api } from './api.ts';
import { PageDesigner } from './PageDesigner.tsx';
import { cloneBlocks } from './block-tree.ts';
import { useManagedRecord } from './EditSessions.tsx';

export default function LayoutManager({ catalog, refresh, publish, onError }: { catalog: any; refresh: () => Promise<any>; publish: () => Promise<any>; onError: (message: string) => void; }) {
  const [kind, setKind] = useState<Layout['kind']>('template');
  const managed = useManagedRecord<any>(null, async row => { const result = await api('layouts',{value:row.value,revision:row.revision}); await refresh(); return result; }, '布局');
  const selected = managed.record, setSelected = managed.setRecord;
  const update = (patch: Partial<Layout>) => setSelected((row: any) => ({ ...row, value: { ...row.value, ...patch } }));
  const save = managed.session.save;
  const select = async (row: any) => { try { await save(); managed.session.adopt(row); } catch (error: any) { onError(error.message); } };
  const create = async () => {
    try {
      await save(); const id = 'layout-' + crypto.randomUUID();
      const value: Layout = { id, kind, label: kind === 'template' ? '新模板' : kind === 'region' ? '新共享区域' : '新区块组合', appliesTo: 'any', blocks: kind === 'template' ? [{ id: crypto.randomUUID(), type: 'entry-body', props: {} }] : [] };
      const row = await api('layouts', { value, revision: null }); await refresh(); await select(row);
    } catch (error: any) { onError(error.message); }
  };
  return <div className="panel layout-manager">
    <div className="panel-title"><h1>布局</h1><div><select aria-label="布局种类" value={kind} onChange={(event) => setKind(event.target.value as Layout['kind'])}><option value="template">模板</option><option value="region">共享区域</option><option value="pattern">区块组合</option></select><button className="primary" onClick={() => void create()}>新建布局</button></div></div>
    <div className="layout-catalog">{catalog.layouts.filter((row: any) => row.value.kind === kind).map((row: any) => <button key={row.id} className={row.id === selected?.id ? 'active' : ''} onClick={() => void select(row)}>{row.value.label}</button>)}</div>
    {selected && <><div className="layout-toolbar"><label>名称<input value={selected.value.label} onChange={(event) => update({ label: event.target.value })} /></label>
      {selected.value.kind === 'template' && <label>适用于<select value={selected.value.appliesTo} onChange={(event) => update({ appliesTo: event.target.value as Layout['appliesTo'] })}><option value="any">所有内容</option><option value="page">页面</option><option value="content">文章与自定义内容</option></select></label>}
      <button onClick={async () => { try { await save(); } catch(error: any) { onError(error.message); } }}>保存布局</button>
      <button onClick={async () => { try { await save(); await publish(); } catch(error: any) { onError(error.message); } }}>发布布局</button>
      <button onClick={async () => {
        try { await save(); const id = 'layout-' + crypto.randomUUID(); const value = { ...selected.value, id, label: selected.value.label + ' 副本', blocks: cloneBlocks(selected.value.blocks) };
          const row = await api('layouts', { value, revision: null }); await refresh(); await select(row);
        } catch (error: any) { onError(error.message); }
      }}>另存副本</button>
    </div><PageDesigner entryId={'layout:' + selected.id} layoutId={selected.id} value={selected.value.blocks} onChange={(blocks) => update({ blocks })} save={save} onError={onError} catalog={catalog} previewKey={JSON.stringify([selected.value.label,selected.value.appliesTo])} /></>}
  </div>;
}
