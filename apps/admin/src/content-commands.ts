import { api } from './api.ts';
import { drafts } from './draft-repository.ts';
import type { useEntryEditor } from './useEntryEditor.ts';
import type { useContentLibrary } from './useContentLibrary.ts';

interface CommandOptions {
  editor: ReturnType<typeof useEntryEditor>;
  library: ReturnType<typeof useContentLibrary>;
  refresh: () => Promise<unknown>;
  notify: (message: string) => void;
}

/** Editing transitions stay together; views receive commands instead of session internals. */
export function contentCommands({ editor, library, refresh, notify }: CommandOptions) {
  const { session, persist, adopt } = editor;
  const current = () => session.record;
  async function check() {
    const row = current();
    if (!row) return;
    const result = await api('entry/check', { value: row.value });
    if (current()?.id === row.id) editor.setContentCheck({ ...result, id: row.id });
  }
  async function openHistory() {
    const row = await persist();
    if (!row) return;
    const rows = await api(`history?id=${encodeURIComponent(row.id)}`);
    if (current()?.id === row.id) editor.setHistory(rows);
  }
  async function openPreview() {
    const row = await persist();
    if (row && current()?.id === row.id)
      editor.setPreview('/__preview/' + row.id + '?revision=' + row.revision);
  }
  async function openLocalDrafts() {
    const row = current();
    if (!row) return;
    try {
      const copies = await drafts().read(row.id);
      if (current()?.id !== row.id) return;
      editor.setRecoveryCopies(copies);
      editor.setRestoreLocal(copies[0]?.record ?? null);
      if (!copies.length) notify('没有未保存的本地草稿。');
    } catch (error: any) {
      editor.setDraftNotice(error.message);
    }
  }
  async function compare() {
    const row = current();
    if (row) await editor.showConflict(row);
  }
  async function restoreHistory(version: number) {
    const row = current();
    if (!row) return;
    const restored = await api('restore', { id: row.id, version, revision: row.revision });
    if (current()?.id === row.id) {
      adopt(restored);
      editor.setHistory(null);
    }
    await refresh();
    notify('历史版本已恢复为工作稿，公开页面保持原版本。');
  }
  async function saveMerge(choices: any) {
    const conflict = editor.conflict;
    if (!conflict) return;
    try {
      const row = await api('entry/merge/save', {
        id: conflict.id,
        baseRevision: conflict.base.revision,
        currentRevision: conflict.remote.revision,
        value: conflict.local,
        choices,
      });
      if (current()?.id === row.id) adopt(row);
      await refresh();
      notify('已保存合并结果。');
    } catch (error: any) {
      if (error.status === 409 && current()?.id === conflict.id) await compare();
      throw error;
    }
  }
  async function openBulk() {
    await persist();
    library.setBulkOpen(true);
  }
  async function finishBulk() {
    await refresh();
    const row = current();
    if (row && library.bulkIds.includes(row.id)) {
      const remote = await api(`entry/${encodeURIComponent(row.id)}`);
      if (current()?.id === row.id) adopt(remote);
    }
    library.setBulkIds([]);
  }
  async function withdraw(archive = false) {
    const row = await persist();
    if (!row) return;
    await api('withdraw', {
      id: row.id,
      revision: row.revision,
      ...(archive ? { archive: true } : {}),
    });
    await refresh();
    if (current()?.id === row.id) await editor.select(row.id);
  }
  async function schedule() {
    const row = await persist();
    if (!row) return;
    await api('schedule', {
      id: row.id,
      revision: row.revision,
      dueAt: new Date(editor.scheduleDueAt).toISOString(),
    });
    editor.setScheduleDueAt('');
    await refresh();
    notify('定时发布已安排');
  }
  async function changeSchedule(action: 'cancel' | 'retry', id: string, revision: number) {
    await api(`schedule/${action}`, { id, revision });
    await refresh();
  }
  return {
    check,
    openHistory,
    openPreview,
    openLocalDrafts,
    compare,
    restoreHistory,
    saveMerge,
    openBulk,
    finishBulk,
    withdraw,
    schedule,
    changeSchedule,
  };
}
