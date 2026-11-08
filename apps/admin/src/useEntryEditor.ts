import { hasNoteContent, type Entry, type Revision } from '@weava/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordEntryLocation } from './admin-location.ts';
import { api } from './api.ts';
import type { ContentState } from './content-models.ts';
import { drafts } from './draft-repository.ts';
import { useEditSessions, useManagedRecord } from './EditSessions.tsx';
import { matchesDraft, saveLocalDraft, type LocalDraft } from './local-drafts.ts';
import { rememberAuthor } from './author-preference.ts';

function hasDraftContent(row: Revision<Entry>) {
  const value = row.value;
  return !!row.revision || !!value.title.trim() || hasNoteContent(value.document) ||
    value.blocks.length > 0 || !!value.description.trim() || !!value.cover ||
    Object.values(value.fields).some(value => value !== undefined && value !== null && value !== '');
}

export interface EntryEditorOptions {
  setError: (message: string) => void;
  onSaved: (row: Revision<Entry>) => void;
  receiveSchedules: (schedules: ContentState['schedules']) => void;
  compact: boolean;
}

export function useEntryEditor({
  setError,
  onSaved,
  receiveSchedules,
  compact,
}: EntryEditorOptions) {
  const editors = useEditSessions();
  const selection = useRef(0),
    conflictRequest = useRef(0),
    paused = useRef(false);
  const localDraftSince = useRef(0);
  const lastLocalDraft = useRef<Revision<Entry> | null>(null);
  const recoveryOrigin = useRef<LocalDraft | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<LocalDraft[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => {
      void drafts()
        .list()
        .then(
          (copies) => {
            if (active) setPendingDrafts(copies);
          },
          () => {},
        );
    };
    load();
    window.addEventListener('weava-drafts-change', load);
    window.addEventListener('storage', load);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('weava-drafts-change', load);
      window.removeEventListener('storage', load);
      window.removeEventListener('focus', load);
    };
  }, []);
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
      if (!hasDraftContent(snapshot)) return snapshot;
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
        onSaved(result);
        if (session.record?.id === result.id) recordEntryLocation(result.id);
        return result;
      } catch (error: any) {
        setError(error.message);
        if (error.status === 409)
          await showConflict(session.record ?? snapshot).catch((error) => setError(error.message));
        throw error;
      } finally {
        setSaving(false);
      }
    },
    '内容编辑',
    {
      recovery: false,
      preserve: async (row) => {
        if (!hasDraftContent(row)) return;
        saveLocalDraft(row, localStorage, Date.now(), drafts().sessionId);
        await drafts().save(row);
      },
      closeMessage: '文章没有保存，是否确认关闭',
      discard: () => {
        if (session.record) forgetDraft(session.record.id);
        resetConflict();
        setEditorEpoch((value) => value + 1);
      },
      saved: (_row, snapshot, unchanged) => {
        const origin = recoveryOrigin.current;
        if (origin?.record.id === snapshot.id) {
          recoveryOrigin.current = null;
          void drafts()
            .discard(origin)
            .catch((error) => setDraftNotice(error.message));
        }
        if (unchanged) {
          void drafts()
            .acknowledge(snapshot)
            .then(
              () => setDraftNotice(''),
              (error) => setDraftNotice(error.message),
            );
          setRecoveryCopies((copies) =>
            copies.filter(
              (copy) => copy !== origin && (copy.sessionId ?? 'legacy') !== drafts().sessionId,
            ),
          );
          setRestoreLocal(null);
        }
      },
    },
  );
  const session = managed.session,
    record = managed.record,
    dirty = session.dirty;
  const persist = useCallback(async () => {
    await editors.prepare();
    return session.save();
  }, [editors, session]);
  const setRecord = session.change;
  function forgetDraft(id: string) {
    void drafts()
      .forget(id)
      .catch((error) => setDraftNotice(error.message));
  }
  function resetConflict() {
    conflictRequest.current++;
    paused.current = false;
    setConflictPaused(false);
    setConflict(null);
    setRestoreLocal(null);
  }
  async function showConflict(row: Revision<Entry>) {
    const request = ++conflictRequest.current;
    paused.current = true;
    setConflictPaused(true);
    for (;;) {
      const checkpoint = session.checkpoint();
      const result = await api('entry/merge', {
        id: row.id,
        baseRevision: row.revision,
        value: row.value,
      });
      if (
        request !== conflictRequest.current ||
        session.record?.id !== row.id ||
        session.checkpoint().generation !== checkpoint.generation
      )
        return;
      if (session.unchanged(checkpoint)) {
        setConflict({ ...result, checkpoint });
        return;
      }
      row = session.record;
    }
  }
  function adopt(row: Revision<Entry>, checkpoint?: ReturnType<typeof session.checkpoint>) {
    if (checkpoint && !session.unchanged(checkpoint)) return false;
    const origin = recoveryOrigin.current;
    if (origin?.record.id === row.id) {
      recoveryOrigin.current = null;
      void drafts()
        .discard(origin)
        .catch((error) => setDraftNotice(error.message));
    }
    session.adopt(row);
    recordEntryLocation(row.revision ? row.id : null);
    resetConflict();
    setEditorEpoch((value) => value + 1);
    forgetDraft(row.id);
    setError('');
    return true;
  }
  function clear(recordHistory = true) {
    ++selection.current;
    session.adopt(null);
    if (recordHistory) recordEntryLocation(null);
    setPreview('');
    setHistory(null);
    resetConflict();
    recoveryOrigin.current = null;
  }
  function update(patch: Partial<Entry>) {
    setContentCheck(null);
    if (patch.author !== undefined) rememberAuthor(patch.author);
    const old = session.record;
    if (!old) return;
    const next = { ...old, value: { ...old.value, ...patch } };
    if (!hasDraftContent(next) && !session.saving) {
      session.adopt(next);
      forgetDraft(next.id);
    } else session.change(next);
  }
  async function recoverDraft(copy: LocalDraft) {
    const local = structuredClone(copy.record),
      server = session.record;
    const checkpoint = session.checkpoint(),
      request = selection.current;
    try {
      await drafts().save(local);
    } catch (error: any) {
      setDraftNotice(error.message);
    }
    if (request !== selection.current || !session.unchanged(checkpoint)) return;
    recoveryOrigin.current = copy;
    if (!local.revision && !server) {
      session.adopt(null);
      session.change(local);
      resetConflict();
    } else if (local.revision === server?.revision && local.id === server?.id) update(local.value);
    else {
      session.change(local);
      await showConflict(local);
    }
    setEditorEpoch((value) => value + 1);
    setRestoreLocal(null);
  }
  async function select(id: string, recordHistory = true) {
    const request = ++selection.current;
    try {
      let row: Revision<Entry>;
      for (;;) {
        await persist();
        if (request !== selection.current) return;
        const before = session.record;
        try {
          row = await api(`entry/${encodeURIComponent(id)}`);
        } catch (error: any) {
          if (error.status === 404) {
            const copies = await drafts().read(id),
              local = copies.find((copy) => copy.record.revision === 0);
            if (request !== selection.current) return;
            if (before !== session.record) continue;
            if (local) {
              session.adopt(null);
              await recoverDraft(local);
              if (recordHistory) recordEntryLocation(id);
              setRecoveryCopies(copies.filter((copy) => copy !== local));
              return;
            }
          }
          throw error;
        }
        if (request !== selection.current) return;
        if (before === session.record) break;
      }
      session.adopt(row);
      if (recordHistory) recordEntryLocation(id);
      resetConflict();
      setEditorEpoch((value) => value + 1);
      setPreview('');
      setHistory(null);
      api(`schedules?entryId=${encodeURIComponent(id)}`)
        .then((schedules) => {
          if (request === selection.current) receiveSchedules(schedules);
        })
        .catch((error) => {
          if (request === selection.current) setError(error.message);
        });
      try {
        const stored = await drafts().read(id);
        const copies = stored.filter((copy) => !matchesDraft(copy, row));
        if (request !== selection.current) return;
        for (const copy of stored)
          if (!copies.includes(copy))
            await drafts().acknowledge(copy.record, copy.sessionId ?? 'legacy');
        if (request !== selection.current) return;
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
    if (!dirty || !record || !hasDraftContent(record)) {
      localDraftSince.current = 0;
      const local = lastLocalDraft.current;
      lastLocalDraft.current = null;
      if (local && record?.id === local.id)
        void drafts()
          .acknowledge(local)
          .catch((error) => setDraftNotice(error.message));
      return;
    }
    localDraftSince.current ||= Date.now();
    const local = setTimeout(
      () => {
        localDraftSince.current = 0;
        if (session.dirty && session.record && hasDraftContent(session.record)) {
          lastLocalDraft.current = session.record;
          void drafts()
            .save(session.record)
            .then(
              () => setDraftNotice(''),
              (error) => setDraftNotice(error.message),
            );
        }
      },
      Math.max(0, Math.min(250, 1000 - (Date.now() - localDraftSince.current))),
    );
    const timer = conflictPaused ? undefined : setTimeout(() => persist().catch(() => {}), 1200);
    return () => {
      clearTimeout(local);
      clearTimeout(timer);
    };
  }, [record, dirty, conflictPaused]);
  useEffect(() => {
    const leave = () => {
      try {
        if (session.dirty && session.record && hasDraftContent(session.record)) {
          lastLocalDraft.current = session.record;
          saveLocalDraft(session.record, localStorage, Date.now(), drafts().sessionId);
        }
      } catch {}
    };
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        persist().catch(() => {});
      }
    };
    window.addEventListener('beforeunload', leave);
    const hidden = () => {
      if (document.visibilityState === 'hidden' && session.dirty && session.record && hasDraftContent(session.record)) {
        lastLocalDraft.current = session.record;
        void drafts()
          .save(session.record)
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', hidden);
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
    pendingDrafts,
    recoverDraft,
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
