import { uploadFile } from './upload-file.ts';
import { useState } from 'react';
import type { Entry } from '@weava/contracts';
import { api, waitJob } from './api.ts';
import { useContentLibrary } from './useContentLibrary.ts';
import { useEntryEditor } from './useEntryEditor.ts';
import { drafts } from './draft-repository.ts';
export interface ContentWorkspaceOptions {
  state: any;
  setState: React.Dispatch<React.SetStateAction<any>>;
  tab: string;
  compact: boolean;
  busy: boolean;
  setError: (message: string) => void;
  notify: (message: string) => void;
  refresh: () => Promise<any>;
  setJob: React.Dispatch<React.SetStateAction<any>>;
  task: (
    operation: 'publish' | 'backup' | 'verify',
    payload?: any,
    reviewed?: boolean,
  ) => Promise<any>;
}
export function useContentWorkspace(options: ContentWorkspaceOptions) {
  const { state, setState, tab, compact, setError, refresh, setJob, task } = options;
  const library = useContentLibrary(state, tab, setError);
  const editor = useEntryEditor({ setError, setLibrary: library.setLibrary, setState, compact });
  const { persist, select, selection } = editor;
  async function createNew(kind: Entry['kind'], type: string, templateId?: string) {
    const request = ++selection.current;
    const row = await api('entries/create', { kind, type, templateId });
    await refresh();
    if (request !== selection.current) return;
    editor.adopt(row);
    editor.setPreview('');
    library.setFilter('');
    library.setStatus('all');
    library.setLibraryType(kind === 'content' ? type : '');

  }
  async function newEntry() {
    try {
      await persist();
      const kind = 'content' as const,
        type = library.libraryType || state.types[0]?.value.id || 'post';
      await createNew(kind, type);
    } catch (error: any) {
      setError(error.message);
    }
  }
  async function duplicateEntry(row: { id: string; revision: number }) {
    await persist();
    const request = ++selection.current;
    const copy = await api('entries/duplicate', { id: row.id, revision: row.revision });
    if (request !== selection.current) return;
    editor.adopt(copy);
    editor.setPreview('');
    library.setFilter('');
    library.setStatus('draft');
    library.setLibraryPage(1);
    options.notify('已复制为新草稿');
    await refresh().catch(error => setError(error.message));
  }
  async function deleteEntry(row: { id: string; revision: number }) {
    await api('entries/delete', { id: row.id, revision: row.revision });
    await drafts().forget(row.id).catch(error => setError(error.message));
    library.setBulkIds(ids => ids.filter(id => id !== row.id));
    if (editor.record?.id === row.id) editor.clear();
    // Move off an emptied last page before reloading the remaining entries.
    if (library.items.length === 1 && library.libraryPage > 1)
      library.setLibraryPage(page => page - 1);
    library.setLibrary((previous: any) => ({ ...previous, total: Math.max(0, previous.total - 1), items: previous.items.filter((item: any) => item.id !== row.id) }));
    options.notify('已删除');
    await refresh().catch(error => setError(error.message));
  }
  async function publish() {
    const row = await persist();
    if (!row) return;
    await task('publish', { ids: [row.id], revisions: { [row.id]: row.revision } });
    await select(row.id);
  }
  async function upload(): Promise<any> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.pdf,.txt,.csv,.vtt,.mp3,.mp4,.webm';
      input.onchange = async () => {
        if (!input.files?.[0]) return resolve(null);
        try {
          const row=await uploadFile(input.files[0],()=>{},setJob);
          await refresh();resolve(row.value);
        } catch (e: any) {
          setError(e.message);
          resolve(null);
        }
      };
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
  return {
    ...options,
    ...library,
    ...editor,
    createNew,
    newEntry,
    duplicateEntry,
    deleteEntry,
    publish,
    upload,
  };
}
export type ContentWorkspace = ReturnType<typeof useContentWorkspace>;
