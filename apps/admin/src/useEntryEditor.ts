import { useEffect, useRef, useState } from 'react';
import type { Entry, Revision } from '@weava/contracts';
import { api } from './api.ts';
import { useManagedRecord } from './EditSessions.tsx';
import {
  localDrafts,
  saveLocalDraft,
  forgetLocalDrafts,
  acknowledgeLocalDrafts,
  type LocalDraft,
} from './local-drafts.ts';

export interface EntryEditorOptions {
  setError: (message: string) => void;
  setLibrary: React.Dispatch<React.SetStateAction<any>>;
  setState: React.Dispatch<React.SetStateAction<any>>;
  compact: boolean;
}

export function useEntryEditor({ setError, setLibrary, setState, compact }: EntryEditorOptions) {
  const selection = useRef(0),
    paused = useRef(false);
  const [saving, setSaving] = useState(false),
    [editorEpoch, setEditorEpoch] = useState(0);
  const [conflict, setConflict] = useState<any>(null),
    [conflictPaused, setConflictPaused] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null),
    [preview, setPreview] = useState(''),
    [narrow, setNarrow] = useState(false);
  const [restoreLocal, setRestoreLocal] = useState<Revision<Entry> | null>(null),
    [recoveryCopies, setRecoveryCopies] = useState<LocalDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState(''),
    [contentCheck, setContentCheck] = useState<any>(null);
  const [scheduleDueAt, setScheduleDueAt] = useState('');
  const managed = useManagedRecord<Revision<Entry>>(
    null,
    async (snapshot) => {
      if (paused.current) {
        await showConflict(snapshot);
        throw new Error('请先处理保存冲突。');
      }
      setSaving(true);
      try {
        const result = await api('entry', {
          value: snapshot.value,
          revision: snapshot.revision || null,
        });
        setLibrary((old: any) => ({
          ...old,
          items: old.items.map((item: any) =>
            item.id === result.id
              ? {
                  ...item,
                  revision: result.revision,
                  updatedAt: result.updatedAt,
                  hasChanges: true,
                  value: {
                    ...item.value,
                    title: result.value.title,
                    description: result.value.description,
                    fields: result.value.fields,
                  },
                }
              : item,
          ),
        }));
        return result;
      } catch (error: any) {
        setError(error.message);
        if (error.status === 409 && snapshot.revision)
          await showConflict(session.record ?? snapshot).catch((error) => setError(error.message));
        throw error;
      } finally {
        setSaving(false);
      }
    },
    '内容编辑',
    {
      recovery: false,
      discard: () => {
        if (session.record) forgetDraft(session.record.id);
        resetConflict();
        setEditorEpoch((value) => value + 1);
      },
      saved: (_row, snapshot, unchanged) => {
        if (unchanged) {
          try {
            acknowledgeLocalDrafts(snapshot.id);
            setDraftNotice('');
          } catch (error: any) {
            setDraftNotice(error.message);
          }
          setRecoveryCopies([]);
        }
      },
    },
  );
  const session = managed.session,
    record = managed.record,
    dirty = session.dirty;
  const persist = session.save,
    setRecord = session.change;
  function forgetDraft(id: string) {
    try {
      forgetLocalDrafts(id);
    } catch (error: any) {
      setDraftNotice(error.message);
    }
  }
  function resetConflict() {
    paused.current = false;
    setConflictPaused(false);
    setConflict(null);
    setRestoreLocal(null);
  }
  async function showConflict(row: Revision<Entry>) {
    paused.current = true;
    setConflictPaused(true);
    setConflict(
      await api('entry/merge', { id: row.id, baseRevision: row.revision, value: row.value }),
    );
  }
  function adopt(row: Revision<Entry>) {
    session.adopt(row);
    resetConflict();
    setEditorEpoch((value) => value + 1);
    forgetDraft(row.id);
    setError('');
  }
  function clear() {
    ++selection.current;
    session.adopt(null);
    setPreview('');
    setHistory(null);
    resetConflict();
  }
  function update(patch: Partial<Entry>) {
    setContentCheck(null);
    session.change((old) => (old ? { ...old, value: { ...old.value, ...patch } } : old));
  }
  async function select(id: string) {
    const request = ++selection.current;
    try {
      let row: Revision<Entry>;
      for (;;) {
        await persist();
        if (request !== selection.current) return;
        const before = JSON.stringify(session.record);
        row = await api(`entry/${encodeURIComponent(id)}`);
        if (request !== selection.current) return;
        if (before === JSON.stringify(session.record)) break;
      }
      session.adopt(row);
      resetConflict();
      setEditorEpoch((value) => value + 1);
      setPreview('');
      setHistory(null);
      api(`schedules?entryId=${encodeURIComponent(id)}`)
        .then((schedules) => {
          if (request === selection.current) setState((old: any) => ({ ...old, schedules }));
        })
        .catch((error) => {
          if (request === selection.current) setError(error.message);
        });
      try {
        const copies = localDrafts(id).filter(
          (copy) =>
            copy.pending !== false &&
            JSON.stringify(copy.record.value) !== JSON.stringify(row.value),
        );
        setRecoveryCopies(copies);
        setRestoreLocal(copies[0]?.record ?? null);
      } catch (error: any) {
        setDraftNotice(error.message || '无法读取浏览器草稿。');
      }
    } catch (error: any) {
      if (request === selection.current) setError(error.message);
    }
  }
  useEffect(() => {
    setContentCheck(null);
  }, [record?.id]);
  useEffect(() => {
    if (!dirty || !record) return;
    try {
      saveLocalDraft(record);
      setDraftNotice('');
    } catch (error: any) {
      setDraftNotice(error.message);
    }
    if (conflictPaused) return;
    const timer = setTimeout(() => persist().catch(() => {}), 1200);
    return () => clearTimeout(timer);
  }, [record, dirty, conflictPaused]);
  useEffect(() => {
    const leave = () => {
      try {
        if (session.dirty && session.record) saveLocalDraft(session.record);
      } catch {}
    };
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        persist().catch(() => {});
      }
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('keydown', key);
    };
  }, [session]);
  useEffect(() => {
    if (!compact || !record) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>('[aria-label="内容标题"]')
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [compact, record?.id]);
  return {
    record,
    setRecord,
    dirty,
    saving,
    session,
    selection,
    editorEpoch,
    setEditorEpoch,
    conflict,
    setConflict,
    conflictPaused,
    history,
    setHistory,
    preview,
    setPreview,
    narrow,
    setNarrow,
    restoreLocal,
    setRestoreLocal,
    recoveryCopies,
    setRecoveryCopies,
    draftNotice,
    setDraftNotice,
    contentCheck,
    setContentCheck,
    scheduleDueAt,
    setScheduleDueAt,
    persist,
    update,
    adopt,
    select,
    clear,
    showConflict,
  };
}
