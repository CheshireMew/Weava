import { entryRecoveryModel } from './entry-recovery-model.ts';
import type { useEntryEditor } from './useEntryEditor.ts';
import type { useContentLibrary } from './useContentLibrary.ts';
import type { ContentWorkspaceOptions } from './useContentWorkspace.ts';
import type {
  ContentCatalog,
  ContentDialogsModel,
  ContentLibraryModel,
  EntryActionsModel,
  EntryEditorModel,
  EntryScheduleModel,
  EntrySettingsModel,
} from './content-models.ts';
import { contentCommands } from './content-commands.ts';

interface ViewOptions {
  editor: ReturnType<typeof useEntryEditor>;
  library: ReturnType<typeof useContentLibrary>;
  options: ContentWorkspaceOptions;
  publicationNotice: string;
  newEntry: (type?: string) => Promise<void>;
  publish: () => Promise<void>;
  duplicateEntry: EntryActionsModel['duplicateEntry'];
  deleteEntry: EntryActionsModel['deleteEntry'];
}
export function contentViewModels({
  editor,
  library,
  options,
  publicationNotice,
  newEntry,
  publish,
  duplicateEntry,
  deleteEntry,
}: ViewOptions) {
  const { state, busy, tab, setError, refresh, notify } = options;
  const commands = contentCommands({ editor, library, refresh, notify });
  const catalog: ContentCatalog = {
    types: state?.types ?? [],
    terms: state?.terms ?? [],
    entries: state?.entries ?? [],
    layouts: state?.layouts ?? [],
    fieldWidgets: state?.fieldWidgets ?? {},
    extensionBlocks: state?.extensionBlocks ?? [],
    extensionBlockDefinitions: state?.extensionBlockDefinitions ?? {},
  };
  const { record, dirty, saving, editorEpoch, contentCheck, update, persist, clear } = editor;
  const recovery = entryRecoveryModel(editor, setError);
  const schedule: EntryScheduleModel = {
    record,
    busy,
    scheduleDueAt: editor.scheduleDueAt,
    setScheduleDueAt: editor.setScheduleDueAt,
    items: state?.schedules ?? [],
    setError,
    create: commands.schedule,
    cancel: (id, revision) => commands.changeSchedule('cancel', id, revision),
    retry: (id, revision) => commands.changeSchedule('retry', id, revision),
  };
  const settings: EntrySettingsModel = {
    record,
    dirty,
    saving,
    contentCheck,
    update,
    setError,
    state: { terms: catalog.terms, entries: catalog.entries },
    schedule,
    moreActions: { record, withdraw: commands.withdraw },
  };
  const editorView: EntryEditorModel = {
    record,
    dirty,
    saving,
    editorEpoch,
    contentCheck,
    update,
    persist,
    clear,
    state: catalog,
    busy,
    setError,
    newEntry,
    publish,
    recovery,
    settings,
    publication: library.items.find((row: any) => row.id === record?.id),
    publicationNotice,
    author: {
      name: state?.settings?.value?.name ?? '',
      logo: state?.siteIcon ?? state?.settings?.value?.logo ?? '',
    },
    check: commands.check,
    openHistory: commands.openHistory,
    openLocalDrafts: commands.openLocalDrafts,
    openPreview: commands.openPreview,
  };
  const {
    libraryLoading,
    filter,
    setFilter,
    status,
    setStatus,
    visibility,
    setVisibility,
    searchTerm,
    libraryPage,
    setLibraryPage,
    library: page,
    libraryType,
    setLibraryType,
    librarySort,
    setLibrarySort,
    bulkIds,
    setBulkIds,
    fieldFilters,
    setFieldFilters,
    items,
  } = library;
  const actions: EntryActionsModel = {
    tab,
    setError,
    select: editor.select,
    duplicateEntry,
    deleteEntry,
  };
  const libraryView: ContentLibraryModel = {
    record,
    state: { types: catalog.types, contentViews: state?.contentViews ?? [] },
    tab,
    busy,
    libraryLoading,
    filter,
    setFilter,
    status,
    setStatus,
    visibility,
    setVisibility,
    searchTerm,
    libraryPage,
    setLibraryPage,
    library: page,
    libraryType,
    setLibraryType,
    librarySort,
    setLibrarySort,
    bulkIds,
    setBulkIds,
    fieldFilters,
    setFieldFilters,
    items,
    pendingDrafts: editor.pendingDrafts,
    setError,
    refresh,
    select: editor.select,
    newEntry,
    openBulk: commands.openBulk,
    actions,
  };
  const dialogs: ContentDialogsModel = {
    bulk: {
      open: library.bulkOpen,
      rows: items.filter((row: any) => bulkIds.includes(row.id)),
      types: catalog.types,
      terms: catalog.terms,
      close: () => library.setBulkOpen(false),
      done: commands.finishBulk,
    },
    history: {
      record,
      items: editor.history,
      close: () => editor.setHistory(null),
      restore: commands.restoreHistory,
    },
    conflict: {
      plan: editor.conflict,
      close: () => editor.setConflict(null),
      useRemote: () => editor.adopt(editor.conflict.remote),
      save: commands.saveMerge,
    },
    preview: {
      url: editor.preview,
      narrow: editor.narrow,
      toggle: () => editor.setNarrow(!editor.narrow),
      close: () => editor.setPreview(''),
    },
    setError,
  };
  return {
    editor: editorView,
    library: libraryView,
    dialogs,
    navigation: {
      current: () => editor.session.record,
      version: () => editor.selection.current,
      cancelSelection: () => {
        ++editor.selection.current;
      },
      select: editor.select,
      adopt: editor.adopt,
      clear: editor.clear,
    },
  };
}
