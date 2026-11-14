import { type Entry, type Revision } from '@weava/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordEntryLocation } from './admin-location.ts';
import { api } from './api.ts';
import type { ContentState } from './content-models.ts';
import { drafts } from './draft-repository.ts';
import { useEditSessions, useManagedRecord } from './EditSessions.tsx';
import { saveLocalDraft } from './local-drafts.ts';
import type { EditSession } from './edit-session.ts';
import { hasDraftContent } from './entry-draft-content.ts';
import { useEntryDrafts } from './useEntryDrafts.ts';
import { useEntryConflict } from './useEntryConflict.ts';
import { useAutosave } from './useAutosave.ts';
import { useEntrySelection } from './useEntrySelection.ts';

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
  const reference = useRef<EditSession<Revision<Entry>> | null>(null);
  const recovery = useEntryDrafts(reference);
  const {
    pendingDrafts,
    restoreLocal,
    setRestoreLocal,
    recoveryCopies,
    setRecoveryCopies,
    draftNotice,
    setDraftNotice,
  } = recovery;
  const conflictState = useEntryConflict(reference);
  const { paused, conflict, setConflict, conflictPaused, showConflict } = conflictState;
  const [saving, setSaving] = useState(false);
  const [narrow, setNarrow] = useState(false);
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
      discard: () => navigation.discarded(),
      saved: (_row, snapshot, unchanged) => recovery.saved(snapshot, unchanged),
    },
  );
  const session = managed.session,
    record = managed.record,
    dirty = session.dirty;
  const persist = useCallback(async () => {
    await editors.prepare();
    return session.save();
  }, [editors, session]);
  reference.current = session;
  useAutosave(session, {
    delay: 1200,
    paused: conflictPaused,
    ready: hasDraftContent,
    save: persist,
  });
  const setRecord = session.change;
  const navigation = useEntrySelection(session, recovery, conflictState, {
    persist,
    receiveSchedules,
    setError,
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        persist().catch(() => {});
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [persist]);
  useEffect(() => {
    if (!compact || !record) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>('[aria-label="内容标题"]')
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [compact, record?.id]);
  const { discarded, ...navigationState } = navigation;
  return {
    ...navigationState,
    record,
    setRecord,
    dirty,
    saving,
    session,
    conflict,
    setConflict,
    conflictPaused,
    narrow,
    setNarrow,
    restoreLocal,
    setRestoreLocal,
    recoveryCopies,
    pendingDrafts,
    setRecoveryCopies,
    draftNotice,
    setDraftNotice,
    scheduleDueAt,
    setScheduleDueAt,
    persist,
    showConflict,
  };
}
