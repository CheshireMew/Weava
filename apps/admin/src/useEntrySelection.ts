import { useEffect, useRef, useState } from 'react';
import type { Entry, Revision } from '@weava/contracts';
import type { EditSession } from './edit-session.ts';
import type { ContentState } from './content-models.ts';
import { recordEntryLocation } from './admin-location.ts';
import { api } from './api.ts';
import { drafts } from './draft-repository.ts';
import { matchesDraft, type LocalDraft } from './local-drafts.ts';
import { hasDraftContent } from './entry-draft-content.ts';
import type { useEntryDrafts } from './useEntryDrafts.ts';
import type { useEntryConflict } from './useEntryConflict.ts';

/** Coordinates selection and recovery without allowing stale requests to replace current edits. */
export function useEntrySelection(
  session: EditSession<Revision<Entry>>,
  recovery: ReturnType<typeof useEntryDrafts>,
  conflict: ReturnType<typeof useEntryConflict>,
  options: {
    persist: () => Promise<Revision<Entry> | null>;
    receiveSchedules: (schedules: ContentState['schedules']) => void;
    setError: (message: string) => void;
  },
) {
  const { persist, receiveSchedules, setError } = options;
  const { recoveryOrigin, setRestoreLocal, setRecoveryCopies, setDraftNotice, forgetDraft } =
    recovery;
  const { showConflict } = conflict;
  const resetConflict = () => {
    conflict.reset();
    setRestoreLocal(null);
  };
  const selection = useRef(0);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [history, setHistory] = useState<any[] | null>(null);
  const [preview, setPreview] = useState('');
  const [contentCheck, setContentCheck] = useState<any>(null);
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
  }, [session.record?.id]);
  function discarded() {
    if (session.record) forgetDraft(session.record.id);
    resetConflict();
    setEditorEpoch((value) => value + 1);
  }
  return {
    selection,
    editorEpoch,
    setEditorEpoch,
    history,
    setHistory,
    preview,
    setPreview,
    contentCheck,
    setContentCheck,
    adopt,
    clear,
    update,
    recoverDraft,
    select,
    discarded,
  };
}
