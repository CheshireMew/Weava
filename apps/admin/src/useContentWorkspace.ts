import type { ContentState, ContentWorkspaceData } from './content-models.ts';
import { contentViewModels } from './content-view-models.ts';

import { entrySchema, hasNoteContent, isNoteType, type Entry } from '@weava/contracts';
import { useEffect, useState } from 'react';
import { api, waitJob } from './api.ts';
import { drafts } from './draft-repository.ts';
import { useContentLibrary } from './useContentLibrary.ts';
import { useEntryEditor } from './useEntryEditor.ts';
import { recentAuthor } from './author-preference.ts';
export interface ContentWorkspaceOptions {
  state: ContentWorkspaceData | null;
  receiveSchedules: (schedules: ContentState['schedules']) => void;
  tab: string;
  compact: boolean;
  busy: boolean;
  isPublishing?: (id?:string)=>boolean;
  publicationPhase?:(id?:string)=>'submitting'|'running'|null;
  setError: (message: string) => void;
  notify: (message: string) => void;
  refresh: () => Promise<any>;
  task: (
    operation: 'publish' | 'backup' | 'verify',
    payload?: any,
    reviewed?: boolean,
  ) => Promise<any>;
}
export function useContentWorkspace(options: ContentWorkspaceOptions) {
  const { state, receiveSchedules, tab, compact, setError, refresh, task } = options;
  const library = useContentLibrary(state, tab, setError);
  const editor = useEntryEditor({
    setError,
    onSaved: library.receiveEntry,
    receiveSchedules,
    compact,
  });
  const { persist, select, selection } = editor;
  const [publicationNotice, setPublicationNotice] = useState('');
  useEffect(() => setPublicationNotice(''), [editor.record?.id]);
  async function newEntry(requestedType?: string) {
    const request = ++selection.current;
    try {
      await persist();
      if (request !== selection.current) return;
      if (tab === 'notes') {
        const definition = state?.types.find((row: any) => isNoteType(row.value));
        if (!definition) throw new Error('网站尚未配置笔记类型。');
        const id = crypto.randomUUID();
        ++selection.current;
        // Opening and closing an empty composer creates no server-side record.
        editor.adopt({
          id,
          revision: 0,
          updatedAt: new Date().toISOString(),
          value: entrySchema.parse({
            id,
            kind: 'content',
            type: definition.id,
            title: '未命名笔记',
            path: definition.value.pathPrefix.replace(/\/?$/, '/') + id.slice(0, 8) + '/',
          }),
        });
        editor.setPreview('');
        return;
      }
      const available = state?.types.filter((row) => !isNoteType(row.value)) ?? [];
      const type =
          requestedType ||
          library.libraryType ||
          available.find((row: any) => row.id === 'post')?.id ||
          (available.length === 1 ? available[0].id : undefined);
      if (!type)
        throw new Error(available.length ? '请先选择要新建的内容类型。' : '网站尚未配置文章类型。');
      if (!available.some((row: any) => row.id === type))
        throw new Error('这个内容类型已不可用，请重新选择。');
      const definition = available.find(row => row.id === type)!;
      const id = crypto.randomUUID();
      editor.adopt({
        id,
        revision: 0,
        updatedAt: new Date().toISOString(),
        value: entrySchema.parse({
          id, kind: 'content', type, title: '', author: recentAuthor(),
          path: definition.value.pathPrefix.replace(/\/?$/, '/') + id.slice(0, 8) + '/',
        }),
      });
      editor.setPreview('');
    } catch (error: any) {
      setError(error.message);
    }
  }
  async function duplicateEntry(row: { id: string; revision: number }) {
    const request = ++selection.current;
    await persist();
    if (request !== selection.current) return;
    const checkpoint = editor.session.checkpoint();
    const copy = await api('entries/duplicate', { id: row.id, revision: row.revision });
    if (request !== selection.current) return;
    if (!editor.adopt(copy, checkpoint)) {
      await refresh();
      options.notify('副本已创建；当前修改仍保留，保存后可从列表打开副本。');
      return;
    }
    editor.setPreview('');
    library.setFilter('');
    library.setStatus('draft');
    library.setLibraryPage(1);
    options.notify('已复制为新草稿');
    await refresh().catch((error) => setError(error.message));
  }
  async function deleteEntry(row: { id: string; revision: number }) {
    const checkpoint = editor.session.checkpoint();
    await waitJob(await api('entries/delete', { id: row.id, revision: row.revision }), () => {});
    const changed = editor.session.record?.id === row.id && !editor.session.unchanged(checkpoint);
    if (changed)
      await drafts()
        .save(editor.session.record!)
        .catch((error) => setError(error.message));
    else
      await drafts()
        .forget(row.id)
        .catch((error) => setError(error.message));
    library.setBulkIds((ids) => ids.filter((id) => id !== row.id));
    if (editor.session.record?.id === row.id && editor.session.unchanged(checkpoint))
      editor.clear();
    // Move off an emptied last page before reloading the remaining entries.
    if (library.items.length === 1 && library.libraryPage > 1)
      library.setLibraryPage((page) => page - 1);
    library.setLibrary((previous: any) => ({
      ...previous,
      total: Math.max(0, previous.total - 1),
      items: previous.items.filter((item: any) => item.id !== row.id),
    }));
    options.notify(changed ? '网站内容已删除；操作期间的新修改保留在本地草稿中。' : '已删除');
    await refresh().catch((error) => setError(error.message));
  }
  async function publish() {
    const row = await persist();
    if (!row) return;
    const note = isNoteType(state?.types.find((type: any) => type.id === row.value.type)?.value);
    if (note) {
      if (!hasNoteContent(row.value.document)) throw new Error('先写点内容再发布。');
      const checkpoint = editor.session.checkpoint();
      const result = await task(
        'publish',
        { ids: [row.id], revisions: { [row.id]: row.revision } },
        true,
      );
      if (result?.status === 'complete') {
        if (editor.session.unchanged(checkpoint)) {
          editor.clear();
          options.notify(row.value.status === 'published' ? '已更新' : '已发布');
        } else if (editor.session.record?.id === row.id)
          setPublicationNotice('先前版本已发布，之后的修改仍保留在这里，尚未发布。');
      }
      return;
    }
    if (!row.value.title.trim()) throw new Error('请填写标题后再发布。');
    await task('publish', { ids: [row.id], revisions: { [row.id]: row.revision } });
  }
  return contentViewModels({
    editor,
    library,
    options,
    publicationNotice,
    newEntry,
    publish,
    duplicateEntry,
    deleteEntry,
  });
}
