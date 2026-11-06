import { api } from './api.ts';
import { drafts } from './draft-repository.ts';
import type { useEntryEditor } from './useEntryEditor.ts';
import type { EntryRecoveryModel } from './content-models.ts';

export function entryRecoveryModel(
  editor: ReturnType<typeof useEntryEditor>,
  setError: (message: string) => void,
): EntryRecoveryModel {
  const current = () => editor.session.record;
  const adopt = editor.adopt;
  async function recoverSelected() {
    const copy = editor.recoveryCopies.find((copy) => copy.record === editor.restoreLocal);
    if (copy) await editor.recoverDraft(copy);
  }
  async function useServer() {
    const row = current();
    if (!row) return;
    const copy = editor.recoveryCopies.find((copy) => copy.record === editor.restoreLocal);
    const server = await api(`entry/${encodeURIComponent(row.id)}`);
    if (current()?.id !== row.id) return;
    if (copy) await drafts().discard(copy);
    if (current()?.id !== row.id) return;
    adopt(server);
    const remaining = editor.recoveryCopies.filter((item) => item !== copy);
    editor.setRecoveryCopies(remaining);
    editor.setRestoreLocal(remaining[0]?.record ?? null);
  }
  return {
    record: editor.record,
    conflictPaused: editor.conflictPaused,
    restoreLocal: editor.restoreLocal,
    recoveryCopies: editor.recoveryCopies,
    draftNotice: editor.draftNotice,
    setError,
    chooseCopy: (index) => editor.setRestoreLocal(editor.recoveryCopies[index]?.record ?? null),
    compare: async () => {
      const row = current();
      if (row) await editor.showConflict(row);
    },
    recoverSelected,
    useServer,
  };
}
