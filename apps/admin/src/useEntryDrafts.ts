import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Entry, Revision } from '@weava/contracts';
import type { EditSession } from './edit-session.ts';
import { drafts } from './draft-repository.ts';
import { saveLocalDraft, type LocalDraft } from './local-drafts.ts';
import { hasDraftContent } from './entry-draft-content.ts';

export function useEntryDrafts(reference: RefObject<EditSession<Revision<Entry>> | null>) {
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
  const [restoreLocal, setRestoreLocal] = useState<Revision<Entry> | null>(null),
    [recoveryCopies, setRecoveryCopies] = useState<LocalDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState('');
  const record = reference.current?.record ?? null,
    dirty = reference.current?.dirty ?? false;
  function forgetDraft(id: string) {
    void drafts()
      .forget(id)
      .catch((error) => setDraftNotice(error.message));
  }
  function saved(snapshot: Revision<Entry>, unchanged: boolean) {
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
  }
  useEffect(() => {
    const session = reference.current!;
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
    return () => {
      clearTimeout(local);
    };
  }, [record, dirty]);
  useEffect(() => {
    const session = reference.current!;
    const leave = () => {
      try {
        if (session.dirty && session.record && hasDraftContent(session.record)) {
          lastLocalDraft.current = session.record;
          saveLocalDraft(session.record, localStorage, Date.now(), drafts().sessionId);
        }
      } catch {}
    };
    window.addEventListener('beforeunload', leave);
    const hidden = () => {
      if (
        document.visibilityState === 'hidden' &&
        session.dirty &&
        session.record &&
        hasDraftContent(session.record)
      ) {
        lastLocalDraft.current = session.record;
        void drafts()
          .save(session.record)
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [reference]);
  return {
    recoveryOrigin,
    pendingDrafts,
    restoreLocal,
    setRestoreLocal,
    recoveryCopies,
    setRecoveryCopies,
    draftNotice,
    setDraftNotice,
    forgetDraft,
    saved,
  };
}
