import { useState } from 'react';
import type { Entry } from '@weava/contracts';
import { api, waitJob } from './api.ts';
import { useContentLibrary } from './useContentLibrary.ts';
import { useEntryEditor } from './useEntryEditor.ts';
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
  const [creating, setCreating] = useState<{ kind: Entry['kind']; type: string } | null>(null);
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
      const kind = tab === 'pages' ? 'page' : 'content',
        type = library.libraryType || state.types[0]?.value.id || 'post';
      if (
        state.creationTemplates?.some(
          (row: any) => row.value.kind === kind && (kind === 'page' || row.value.type === type),
        )
      ) {
        setCreating({ kind, type });
        return;
      }
      await createNew(kind, type);
    } catch (error: any) {
      setError(error.message);
    }
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
          const file = input.files[0],
            reader = new FileReader();
          reader.onload = async () => {
            try {
              const result = await api('media', {
                name: file.name,
                base64: String(reader.result).split(',')[1],
              });
              const finished = await waitJob(result, setJob);
              await refresh();
              resolve(finished.result.value);
            } catch (e: any) {
              setError(e.message);
              resolve(null);
            }
          };
          reader.readAsDataURL(file);
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
    creating,
    setCreating,
    createNew,
    newEntry,
    publish,
    upload,
  };
}
export type ContentWorkspace = ReturnType<typeof useContentWorkspace>;
