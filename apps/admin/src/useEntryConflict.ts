import { useRef, useState, type RefObject } from 'react';
import type { Entry, Revision } from '@weava/contracts';
import type { EditSession } from './edit-session.ts';
import { api } from './api.ts';
export function useEntryConflict(reference: RefObject<EditSession<Revision<Entry>> | null>) {
  const conflictRequest = useRef(0),
    paused = useRef(false);
  const [conflict, setConflict] = useState<any>(null),
    [conflictPaused, setConflictPaused] = useState(false);
  function resetConflict() {
    conflictRequest.current++;
    paused.current = false;
    setConflictPaused(false);
    setConflict(null);
  }
  async function showConflict(row: Revision<Entry>) {
    const session = reference.current!;
    const request = ++conflictRequest.current;
    paused.current = true;
    setConflictPaused(true);
    try { for (;;) {
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
    } } catch (error) {
      // A failed comparison must not silently leave autosave paused forever.
      if (request === conflictRequest.current && !conflict) {
        paused.current = false;
        setConflictPaused(false);
      }
      throw error;
    }
  }
  return { paused, conflict, setConflict, conflictPaused, reset: resetConflict, showConflict };
}
