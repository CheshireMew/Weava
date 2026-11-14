import { Suspense, useEffect, useRef, useState } from 'react';
import { retryableLazy as lazy } from './ErrorBoundary.tsx';
import { workspaceData } from './content-models.ts';
import { useAdminNavigation } from './useAdminNavigation.ts';
import { useAdminShell, useSiteIcon } from './useAdminShell.ts';
import { useAdminState } from './useAdminState.ts';
import { useScheduleUpdates } from './useScheduleUpdates.ts';

import { Check, Menu } from 'lucide-react';

import { api } from './api.ts';
import {adminQueries} from './query-cache.ts';
import {affectedQueries} from './query-effects.ts';

import { FieldWidgetsProvider } from './Fields.tsx';

import { Dialog } from './Dialog.tsx';
import { useEditSessions } from './EditSessions.tsx';

import { isNoteType } from '@weava/contracts';
import { AdminNavigation, adminTabLabel } from './AdminNavigation.tsx';
import { ContentDialogs } from './ContentDialogs.tsx';
import { ContentLibrary } from './ContentLibrary.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { LoginScreen } from './LoginScreen.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { NotesLibrary } from './NotesLibrary.tsx';
import { PublicationDialog } from './PublicationDialog.tsx';
import { Reauthentication } from './Reauthentication.tsx';
import { adminPanel } from './admin-location.ts';
import './style.css';
import type { AdminSession } from './useAdminSession.ts';
import { useContentWorkspace } from './useContentWorkspace.ts';
import { usePublication } from './usePublication.ts';
import { useSettingsApplication } from './useSettingsApplication.ts';
import { useTransientMessage } from './useTransientMessage.ts';
import { LoadingState } from './LoadingState.tsx';
import { MediaUploadFeedback } from './media-uploads.tsx';

const panelModules = {
  appearance: () => import('./SettingsPanel.tsx'),
  operations: () => import('./Operations.tsx'),
  account: () => import('./AccountPanel.tsx'),
  analytics: () => import('./AnalyticsPanel.tsx'),
  comments: () => import('./Comments.tsx'),
  media: () => import('./MediaManager.tsx'),
  trash: () => import('./Trash.tsx'),
};
const preloadPanel = (panel: string) => {
  const load = panelModules[panel as keyof typeof panelModules];
  if (load) void load().catch(() => {});
};
const SettingsPanel = lazy(panelModules.appearance);
const Operations = lazy(panelModules.operations);
const AccountPanel = lazy(panelModules.account);
const AnalyticsPanel = lazy(panelModules.analytics);

const Comments = lazy(panelModules.comments);

const MediaManager = lazy(panelModules.media);
const TrashPanel = lazy(panelModules.trash);
export interface AppProps {
  authentication: AdminSession;
  error: string;
  setError: (message: string) => void;
}
export function App({ authentication, error, setError }: AppProps) {
  const editors = useEditSessions();
  const { compact, menu, setMenu, toast, setToast, notify } = useAdminShell();
  const [tab, setTab] = useState(() => adminPanel(window.location.search)),
    [completedPublication, setCompletedPublication] = useState(0);
  const activeTab = useRef(tab);
  const { session } = authentication;
  const { state, statePanel, panelQuery, receiveState, receiveSchedules, refresh, sync } = useAdminState({
    authenticated: !!session?.authenticated,
    tab,
    activeTab,
    setTab,
    setError,
    currentEntry: () => workspace.navigation.current(),
  });
  const publicationController = usePublication(sync, setError, notify);
  const { busy, setPublication, task } = publicationController;
  const workspace = useContentWorkspace({
    state: workspaceData(state),
    receiveSchedules,
    tab,
    compact,
    busy,
    isPublishing: publicationController.isPublishing,
    publicationPhase:publicationController.publicationPhase,
    setError,
    notify,
    refresh: sync,
    task,
  });
  const { record } = workspace.editor;
  const feedbackContext = tab + ':' + (record?.id ?? 'list');
  useTransientMessage(error, () => setError(''), feedbackContext, 0);
  useTransientMessage(toast, () => setToast(''), feedbackContext, 3000);
  useEffect(() => {
    if (!completedPublication) return;
    notify('已发布');
    document.querySelector<HTMLElement>('.library')?.focus({ preventScroll: true });
  }, [completedPublication]);
  useSiteIcon(state?.siteIcon ?? state?.settings.value.logo);
  const settingsApplication = useSettingsApplication(sync, () => notify('已保存并生效', 2600),setError,!state?.features||state.features.includes('content'));
  useEffect(() => {
    if (state?.settingsPending || state?.termsPending) settingsApplication.resumePending();
  }, [state?.settingsPending, state?.termsPending, settingsApplication]);
  const focusedWriting = tab === 'content' && record?.value.kind === 'content';
  async function saveSiteSettings(value: any, revision: number) {
    // One revalidation after both saving and applying. Forms still receive their
    // saved revision immediately, so newer edits can continue while it publishes.
    const end=adminQueries.beginWrite(affectedQueries(['settings','publication']));
    try{
      const row=await api('settings',{value,revision});
      settingsApplication.request();void settingsApplication.flush().then(()=>end(),()=>end());
      return row;
    }catch(error){end();throw error;}
  }
  useScheduleUpdates(
    state?.schedules ?? [],
    () => workspace.navigation.current(),
    receiveSchedules,
    setError,
  );
  const navigate = useAdminNavigation({
    tab,
    setTab,
    activeTab,
    authenticated: !!session?.authenticated,
    ready: !!panelQuery.data,
    selection: workspace.navigation,
    editors,
    receiveState,
    setMenu,
    setError,
    preloadPanel,
  });
  async function logout() {
    try {
      await editors.flush();
      await api('logout', {});
      workspace.navigation.clear();
      authentication.setSession((current: any) =>
        current ? { ...current, authenticated: false } : current,
      );
    } catch (error: any) {
      setError(error.message);
    }
  }
  if (!session?.authenticated)
    return <LoginScreen model={authentication} error={error} setError={setError} />;
  const navigation = (
    <AdminNavigation
      compact={compact}
      state={state}
      tab={tab}
      setMenu={setMenu}
      navigate={navigate}
      preload={preloadPanel}
      logout={logout}
    />
  );
  return (
    <FieldWidgetsProvider value={state?.fieldWidgets ?? {}}>
      <div className={'app' + (focusedWriting ? ' writing-focus' : '')}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {!focusedWriting &&
          (compact ? (
            menu && (
              <Dialog
                className="sidebar mobile-sidebar"
                label="网站管理"
                onClose={() => setMenu(false)}
              >
                {navigation}
              </Dialog>
            )
          ) : (
            <aside className="sidebar">{navigation}</aside>
          ))}
        <main className="main-shell" id="main-content" tabIndex={-1}>
          {tab !== 'media' && <MediaUploadFeedback />}
          {compact && !focusedWriting && (
            <header className="topbar">
              <button
                className="mobile-toggle"
                onClick={() => setMenu(!menu)}
                aria-label="打开菜单"
                aria-expanded={menu}
                aria-haspopup="dialog"
              >
                <Menu size={20} />
              </button>
              <div className="breadcrumb">
                <span className="breadcrumb-site">{state?.settings.value.name}</span>
                <span aria-hidden="true">/</span>
                <strong className="breadcrumb-current">
                  {adminTabLabel(tab, state?.types)}
                </strong>
              </div>
            </header>
          )}
          {!state || (tab === 'appearance' && statePanel !== tab) ? (
            <div className="loading-screen">
              {panelQuery.error ? (
                <button onClick={() => void panelQuery.refresh().catch(() => {})}>重新载入</button>
              ) : (
                <LoadingState />
              )}
            </div>
          ) : (
            <ErrorBoundary
              resetKey={tab}
              onReload={async () => {
                await editors.preserve();
                window.location.reload();
              }}
            >
              <Suspense fallback={<LoadingState />}>
                {['content', 'notes'].includes(tab) && (
                  <div
                    className={
                      'content-workspace' + (record && tab !== 'notes' ? ' has-record' : '')
                    }
                  >
                    {tab === 'notes' ? (
                      <>
                        <NotesLibrary model={workspace.library} />
                        {record &&
                          isNoteType(
                            state.types.find((row: any) => row.id === record.value.type)?.value,
                          ) && <NoteEditor model={workspace.editor} error={error} />}
                      </>
                    ) : record ? (
                      <EntryEditor model={workspace.editor} />
                    ) : (
                      <ContentLibrary model={workspace.library} />
                    )}
                  </div>
                )}
                {tab === 'trash' && <Suspense fallback={<LoadingState label="载入回收站" />}><TrashPanel/></Suspense>}
                {tab === 'media' && (
                  <Suspense fallback={<LoadingState label="载入媒体" />}>
                    <MediaManager
                      onError={setError}
                      onOpen={(id) => {
                        api(`entry/${encodeURIComponent(id)}`)
                          .then(async (row) => {
                            if (row.value.kind === 'page') await navigate('appearance');
                            else if (
                              await navigate(
                                isNoteType(
                                  state.types.find((type: any) => type.id === row.value.type)
                                    ?.value,
                                )
                                  ? 'notes'
                                  : 'content',
                              )
                            )
                              await workspace.navigation.select(id);
                          })
                          .catch((error) => setError(error.message));
                      }}
                    />
                  </Suspense>
                )}
                {tab === 'appearance' && (
                  <SettingsPanel
                    row={state.settings}
                    contentEnabled={!state.features || state.features.includes('content')}
                    themes={state.themes ?? []}
                    panels={state.extensionPanels ?? []}
                    layouts={state.layouts ?? []}
                    application={settingsApplication.state}
                    applyTerms={settingsApplication.request}
                    save={saveSiteSettings}
                    onError={setError}
                    siteInfo={state.siteInfo}
                    terms={state.terms ?? []}
                    refresh={refresh}
                    initialSection={
                      new URLSearchParams(window.location.search).get('panel') === 'terms'
                        ? 'navigation'
                        : undefined
                    }
                  />
                )}
                {tab === 'analytics' && (
                  <AnalyticsPanel onError={setError} timezone={state.settings.value.timezone} />
                )}
                {tab === 'comments' && (
                  <Suspense fallback={<LoadingState label="载入评论" />}>
                    <Comments
                      settings={state.settings}
                      saveSettings={saveSiteSettings}
                      application={settingsApplication.state}
                      onError={setError}
                    />
                  </Suspense>
                )}
                {tab === 'account' && (
                  <Suspense fallback={<LoadingState label="读取账户" />}>
                    <AccountPanel
                      sessionGeneration={authentication.sessionGeneration}
                      setError={setError}
                      notify={notify}
                    />
                  </Suspense>
                )}
                {tab === 'operations' && (
                  <Operations
                    contentEnabled={!state.features || state.features.includes('content')}
                    refresh={async () => {
                      await refresh();
                    }}
                    onError={setError}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          )}
        </main>

        {error && !publicationController.publication && !(tab === 'notes' && record) ? (
          <div className="toast error-toast" role="alert">
            <span>{error}</span>
            <button aria-label="关闭提示" onClick={() => setError('')}>
              ×
            </button>
          </div>
        ) : (
          toast && (
            <div className="toast success-toast" role="status" aria-live="polite" aria-atomic="true">
              <Check size={17} strokeWidth={2} aria-hidden="true" />
              <span>{toast}</span>
            </div>
          )
        )}
        <PublicationDialog
          model={publicationController}
          error={error}
          onPublished={async () => {
            try {
              await editors.flush();
              if(tab==='content'){
                workspace.library.setStatus('all');
                workspace.library.setLibraryPage(1);
              }
              workspace.navigation.clear();
              setCompletedPublication(value => value + 1);
            } catch (error: any) {
              setError('内容已发布，返回列表时保存后续修改失败：' + error.message);
            }
          }}
        />
        <Reauthentication
          model={authentication}
          setError={setError}
          dirty={workspace.editor.dirty}
          onAuthenticated={async () => {
            setPublication(null);
            await editors.flush();
          }}
        />
        <ContentDialogs model={workspace.dialogs} />
      </div>
    </FieldWidgetsProvider>
  );
}
