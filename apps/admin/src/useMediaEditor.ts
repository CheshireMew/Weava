import { api } from './api.ts';
import { useRef } from 'react';
import { useManagedRecord, usePendingEditWork } from './EditSessions.tsx';
import type { MediaRecord } from './media-models.ts';
export function useMediaEditor(refresh: () => void, onError: (message: string) => void) {
  const pending = useRef<Promise<void> | null>(null);
  usePendingEditWork(() => pending.current);
  const managed = useManagedRecord<MediaRecord>(
    null,
    async (snapshot) => {
      const { name, alt, caption, focalPoint } = snapshot.value;
      const row = await api('media/info', {
        id: snapshot.id,
        revision: snapshot.revision,
        value: { name, alt, caption, focalPoint, groupId: snapshot.value.groupId ?? null },
      });
      refresh();
      return row;
    },
    '媒体信息',
    {
      autosave: {
        ready: (record) =>
          !!record.value.name.trim() &&
          (!record.value.focalPoint ||
            Object.values(record.value.focalPoint).every(
              (point) =>
                typeof point === 'number' && Number.isFinite(point) && point >= 0 && point <= 100,
            )),
      },
    },
  );
  const selected = managed.record,
    setSelected = managed.setRecord;
  const flush = () => managed.session.save();
  async function save() {
    const row = await flush();
    if (!row) throw new Error('请先选择媒体。');
    return row;
  }
  const choose = async (row: MediaRecord | null) => {
    try {
      await pending.current;
      await flush();
      // The list may still contain the revision from before this editor's save.
      if (row && row.id === managed.session.record?.id && row.revision <= managed.session.record.revision) return;
      managed.session.adopt(row);
    } catch (error: any) {
      onError(error.message);
    }
  };
  const accept = (row: MediaRecord) => {
    managed.session.adopt(row);
    refresh();
  };
  const receive = (row: MediaRecord) => {
    if (managed.session.record?.id === row.id) managed.session.receive(row);
  };
  const receiveUpload = (row: MediaRecord) => {
    const current = managed.session.record;
    if (!current || current.id !== row.id || current.revision >= row.revision || managed.session.saving) return;
    const dirty = managed.session.dirty;
    managed.session.adopt(row);
    if (dirty) {
      const { name, alt, caption, focalPoint } = current.value;
      managed.session.change({ ...row, value: { ...row.value, name, alt, caption, focalPoint } });
    }
  };
  async function performMutation(work: () => Promise<void>) {
    if (pending.current) throw new Error('媒体操作尚未完成，请稍候。');
    const operation = work();
    pending.current = operation;
    try { await operation; } finally { pending.current = null; }
  }
  function mutateSelection(rows: MediaRecord[], write: (items: {id:string;revision:number}[]) => Promise<MediaRecord[]>) {
    return performMutation(async () => {
      await managed.session.mutate(async snapshot => {
        const changed = await write(rows.map(row => ({id:row.id,revision:row.id === snapshot?.id ? snapshot.revision : row.revision})));
        return changed.find(row => row.id === snapshot?.id) ?? snapshot;
      });
      refresh();
    });
  }
  async function remove(row: MediaRecord) {
    let cleanupPending = false;
    await performMutation(async () => {
      await managed.session.mutate(async snapshot => {
        const revision = snapshot?.id === row.id ? snapshot.revision : row.revision;
        const result = await api('media/delete', {id: row.id, revision, confirmation: '永久删除'});
        cleanupPending = result.cleanupPending;
        return snapshot?.id === row.id ? null : snapshot;
      });
      if (managed.session.record?.id === row.id) managed.session.adopt(null);
      refresh();
    });
    return {cleanupPending};
  }
  return {
    selected,
    setSelected,
    save,
    flush,
    choose,
    accept,
    receive,
    receiveUpload,
    mutateSelection,
    remove,
    autoSave: managed.autoSave,
  };
}
export type MediaEditor = ReturnType<typeof useMediaEditor>;
