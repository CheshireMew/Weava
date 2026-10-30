import { useState } from 'react';
import type { MediaGroup, Revision } from '@weava/contracts';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';

export function MediaGroups({ rows, refresh, close, onError }: { rows: Revision<MediaGroup>[]; refresh: () => void; close: () => void; onError: (message: string) => void }) {
  const [selected, setSelected] = useState<Revision<MediaGroup> | null>(null), [label, setLabel] = useState(''), [busy, setBusy] = useState(false);
  const save = async (archived = selected?.value.archived ?? false) => {
    setBusy(true);
    try { await api('media/groups', { value: { id: selected?.id ?? crypto.randomUUID(), label, archived }, revision: selected?.revision ?? null }); setSelected(null); setLabel(''); refresh(); }
    catch (error: any) { onError(error.message); } finally { setBusy(false); }
  };
  return <Dialog label="媒体分组" onClose={close} dismissible={!busy}><div className="modal-title"><h2>媒体分组</h2><button disabled={busy} onClick={close}>关闭</button></div><div className="object-list">{rows.map((row) => <button key={row.id} aria-current={selected?.id === row.id ? 'true' : undefined} onClick={() => { setSelected(row); setLabel(row.value.label); }}>{row.value.label}{row.value.archived ? '（已归档）' : ''}</button>)}</div><label>分组名称<input data-autofocus value={label} onChange={(event) => setLabel(event.target.value)} /></label><div className="inline"><button disabled={busy || !label.trim()} onClick={() => save()}>保存分组</button>{selected && <><button disabled={busy} onClick={() => save(!selected.value.archived)}>{selected.value.archived ? '恢复分组' : '归档分组'}</button><button disabled={busy} onClick={() => { setSelected(null); setLabel(''); }}>新建分组</button></>}</div></Dialog>;
}
