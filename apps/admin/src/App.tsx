import { Suspense, useEffect, useRef, useState } from 'react';
import { retryableLazy as lazy } from './ErrorBoundary.tsx';
import { workspaceData } from './content-models.ts';
import { useAdminNavigation } from './useAdminNavigation.ts';
import { useAdminShell, useSiteIcon } from './useAdminShell.ts';
import { useAdminState } from './useAdminState.ts';
import { useScheduleUpdates } from './useScheduleUpdates.ts';

import { Check, Loader2, Menu } from 'lucide-react';

import { api } from './api.ts';

import { FieldWidgetsProvider } from './Fields.tsx';

import { Dialog } from './Dialog.tsx';
import { useEditSessions } from './EditSessions.tsx';
import { JobLogs } from './JobLogs.tsx';

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
import { operationLabels } from './admin-labels.ts';
import { MediaUploadFeedback } from './media-uploads.tsx';

const panelModules = {
  appearance: () => import('./SettingsPanel.tsx'),
  operations: () => import('./Operations.tsx'),
  account: () => import('./AccountPanel.tsx'),
  analytics: () => import('./AnalyticsPanel.tsx'),
  comments: () => import('./Comments.tsx'),
  media: () => import('./MediaManager.tsx'),
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
export interface AppProps {
  authentication: AdminSession;
  error: string;
  setError: (message: string) => void;
}
export function App({ authentication, error, setError }: AppProps) {
  const editors = useEditSessions();
  const { compact, menu, setMenu, toast, setToast, notify } = useAdminShell();
  const [tab, setTab] = useState(() => adminPanel(window.location.search)),
    [logJob, setLogJob] = useState<string | null>(null);
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
  const { busy, job, setPublication, task } = publicationController;
  const workspace = useContentWorkspace({
    state: workspaceData(state),
    receiveSchedules,
    tab,
    compact,
    busy,
    isPublishing: publicationController.isPublishing,
    setError,
    notify,
    refresh: sync,
    task,
  });
  const { record } = workspace.editor;
  const feedbackContext = tab + ':' + (record?.id ?? 'list');
  useTransientMessage(error, () => setError(''), feedbackContext, 0);
  useTransientMessage(toast, () => setToast(''), feedbackContext, 3000);
  useSiteIcon(state?.siteIcon ?? state?.settings.value.logo);
  const settingsApplication = useSettingsApplication(sync, () => notify('已保存并生效', 2600),setError);
  useEffect(() => {
    if (state?.settingsPending || state?.termsPending) settingsApplication.resumePending();
  }, [state?.settingsPending, state?.termsPending, settingsApplication]);
  const focusedWriting = tab === 'content' && record?.value.kind === 'content';
  async function saveSiteSettings(value: any, revision: number) {
    const row = await api('settings', { value, revision });
    settingsApplication.request();
    void sync().catch(error=>setError('设置已保存，刷新页面数据失败：'+error.message));
    return row;
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
          {job && !publicationController.publication && !error && (
            <div className="toast operation-progress" role="status">
              <Loader2 className="spin" size={15} aria-hidden="true" />
              <span>{operationLabels[job.operation] ?? '处理操作'}…</span>
              <button onClick={() => setLogJob(job.id)}>查看日志</button>
            </div>
          )}
          {!state || (['appearance', 'operations'].includes(tab) && statePanel !== tab) ? (
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
                    state={state}
                    busy={busy}
                    pending={publicationController.pending}
                    task={task}
                    refresh={async () => {
                      await refresh();
                    }}
                    onError={setError}
                    openLogs={setLogJob}
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
            <div className="toast" role="status" aria-live="polite" aria-atomic="true">
              <Check size={17} strokeWidth={2} aria-hidden="true" />
              <span>{toast}</span>
            </div>
          )
        )}
        <PublicationDialog
          model={publicationController}
          error={error}
          onPublished={async () => {
            const row = workspace.navigation.current();
            if (row) await workspace.navigation.select(row.id);
          }}
        />
        {logJob && <JobLogs key={logJob} id={logJob} onClose={() => setLogJob(null)} />}
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
