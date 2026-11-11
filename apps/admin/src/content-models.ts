import type { Entry, Revision } from '@weava/contracts';
import type { ApiOutput } from '@weava/contracts/api';
import type { Dispatch, SetStateAction } from 'react';
import type { LocalDraft } from './local-drafts.ts';

export type ContentState = ApiOutput<'state'>;
export type EntryRecord = Revision<Entry>;
export type ContentPage = ApiOutput<'queryEntries'>;
export type EntrySummary = ContentPage['items'][number];
export type ContentCatalog = Pick<ContentState,'types'|'terms'|'entries'|'layouts'|'fieldWidgets'|'extensionBlocks'|'extensionBlockDefinitions'>;
export type ContentWorkspaceData = ContentCatalog &
  Pick<ContentState, 'contentViews' | 'schedules' | 'features'> & {
    timezone?: string;
    authors?: string[];
    author: { name: string; logo: string };
  };
export function workspaceData(state: ContentState | null): ContentWorkspaceData | null {
  if (!state) return null;
  const {
    types,
    terms,
    entries,
    layouts,
    fieldWidgets,
    extensionBlocks,
    extensionBlockDefinitions,
    contentViews,
    schedules,
    features,
  } = state;
  return {
    types,
    terms,
    entries,
    layouts,
    fieldWidgets,
    extensionBlocks,
    extensionBlockDefinitions,
    contentViews,
    schedules,
    features,
    timezone: state.settings.value.timezone,
    authors: state.authors ?? [],
    author: { name: state.settings.value.name, logo: state.siteIcon ?? state.settings.value.logo },
  };
}
export type ContentCheck = ApiOutput<'checkEntry'> & { id: string };
type Change<T> = Dispatch<SetStateAction<T>>;

export interface EntryRecoveryModel {
  record: EntryRecord | null;
  conflictPaused: boolean;
  restoreLocal: EntryRecord | null;
  recoveryCopies: LocalDraft[];
  draftNotice: string;
  setError: (message: string) => void;
  chooseCopy: (index: number) => void;
  compare: () => Promise<void>;
  recoverSelected: () => Promise<void>;
  useServer: () => Promise<void>;
}
export interface EntryScheduleModel {
  timezone?: string;
  record: EntryRecord | null;
  busy: boolean;
  scheduleDueAt: string;
  setScheduleDueAt: (value: string) => void;
  items: ContentState['schedules'];
  setError: (message: string) => void;
  create: (occurrence?: 'earlier' | 'later') => Promise<void>;
  cancel: (id: string, revision: number) => Promise<void>;
  retry: (id: string, revision: number) => Promise<void>;
}
export interface EntryMoreActionsModel {
  record: EntryRecord | null;
  withdraw: (archive?: boolean) => Promise<void>;
}
export interface EntrySettingsModel {
  record: EntryRecord | null;
  dirty: boolean;
  saving: boolean;
  contentCheck: ContentCheck | null;
  update: (patch: Partial<Entry>) => void;
  setError: (message: string) => void;
  state: Pick<ContentCatalog, 'terms' | 'entries'> & { types?: ContentCatalog['types']; authors?: string[] };
  refresh: () => Promise<unknown>;
  schedule: EntryScheduleModel;
  moreActions: EntryMoreActionsModel;
}
export interface EntryEditorModel {
  record: EntryRecord | null;
  dirty: boolean;
  saving: boolean;
  editorEpoch: number;
  contentCheck: ContentCheck | null;
  state: ContentCatalog;
  busy: boolean;
  publicationPhase?:'submitting'|'running'|null;
  publication: EntrySummary | undefined;
  publicationNotice: string;
  update: (patch: Partial<Entry>) => void;
  persist: () => Promise<EntryRecord | null>;
  clear: () => void;
  setError: (message: string) => void;
  newEntry: () => Promise<void>;
  publish: () => Promise<void>;
  check: () => Promise<void>;
  openHistory: () => Promise<void>;
  openLocalDrafts: () => Promise<void>;
  openPreview: () => Promise<void>;
  recovery: EntryRecoveryModel;
  settings: EntrySettingsModel;
  author: { name: string; logo: string };
}
export interface EntryActionsModel {
  tab: string;
  setError: (message: string) => void;
  select: (id: string) => Promise<void>;
  duplicateEntry: (row: { id: string; revision: number }) => Promise<void>;
  deleteEntry: (row: { id: string; revision: number }) => Promise<void>;
}
export type NoteEditorModel = Pick<
  EntryEditorModel,
  | 'record'
  | 'saving'
  | 'update'
  | 'persist'
  | 'publish'
  | 'setError'
  | 'clear'
  | 'editorEpoch'
  | 'busy'
  | 'author'
  | 'publicationNotice'
  | 'recovery'
>;
export interface ContentLibraryModel {
  timezone?: string;
  record: EntryRecord | null;
  state: Pick<ContentState, 'types' | 'contentViews'>;
  tab: string;
  busy: boolean;
  libraryLoading: boolean;
  filter: string;
  setFilter: Change<string>;
  status: string;
  setStatus: Change<string>;
  visibility: string;
  setVisibility: Change<string>;
  searchTerm: string;
  libraryPage: number;
  setLibraryPage: Change<number>;
  library: ContentPage;
  libraryType: string;
  setLibraryType: Change<string>;
  librarySort: string;
  setLibrarySort: Change<string>;
  bulkIds: string[];
  setBulkIds: Change<string[]>;
  fieldFilters: Record<string, string>;
  setFieldFilters: Change<Record<string, string>>;
  items: EntrySummary[];
  pendingDrafts: LocalDraft[];
  setError: (message: string) => void;
  refresh: () => Promise<unknown>;
  select: (id: string) => Promise<void>;
  newEntry: (type?: string) => Promise<void>;
  openBulk: () => Promise<void>;
  actions: EntryActionsModel;
}
export interface ContentDialogsModel {
  bulk: {
    open: boolean;
    rows: EntrySummary[];
    types: ContentState['types'];
    terms: ContentState['terms'];
    close: () => void;
    done: () => Promise<void>;
  };
  history: {
    record: EntryRecord | null;
    items: unknown[] | null;
    close: () => void;
    restore: (version: number) => Promise<void>;
  };
  conflict: {
    plan: any;
    close: () => void;
    useRemote: () => void;
    save: (choices: any) => Promise<void>;
  };
  preview: { url: string; narrow: boolean; toggle: () => void; close: () => void };
  setError: (message: string) => void;
}
