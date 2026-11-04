import { useState, useEffect, useRef, lazy, Suspense } from 'react';

import { Menu, Loader2 } from 'lucide-react';

import { api } from './api.ts';

import { FieldWidgetsProvider } from './Fields.tsx';

import { Dialog } from './Dialog.tsx';
import { JobLogs } from './JobLogs.tsx';
import { useEditSessions } from './EditSessions.tsx';

import './style.css';

const SettingsPanel=lazy(()=>import('./SettingsPanel.tsx'));
const Operations=lazy(()=>import('./Operations.tsx'));
import { AdminNavigation, tabs } from './AdminNavigation.tsx';
import { adminPanel, panelUrl } from './admin-location.ts';
import type { AdminSession } from './useAdminSession.ts';
import { LoginScreen } from './LoginScreen.tsx';
import { Reauthentication } from './Reauthentication.tsx';
import { useContentWorkspace } from './useContentWorkspace.ts';
import { ContentLibrary } from './ContentLibrary.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { ContentDialogs } from './ContentDialogs.tsx';
import { usePublication } from './usePublication.ts';
import { PublicationDialog } from './PublicationDialog.tsx';
const SearchTools = lazy(() => import('./SearchTools.tsx'));
const AccountPanel = lazy(() => import('./AccountPanel.tsx'));
const AnalyticsPanel = lazy(() => import('./AnalyticsPanel.tsx'));

const RedirectManager = lazy(() => import('./RedirectManager.tsx'));
const Comments = lazy(() => import('./Comments.tsx'));

const MediaManager = lazy(() => import('./MediaManager.tsx'));

export interface AppProps {authentication:AdminSession;error:string;setError:(message:string)=>void}
export function App({authentication,error,setError}:AppProps) {
  const editors = useEditSessions();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [toast, setToast] = useState(''),
    [tab, setTab] = useState(() => adminPanel(window.location.search)),
    [state, setState] = useState<any>(null),
    [logJob, setLogJob] = useState<string | null>(null),
    [menu, setMenu] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationVersion=useRef(0);
  const { session } = authentication;
  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }
  async function refresh(panel = tab, current = ()=>true) {
    const record = workspace.session.record;
    const data = await api(
      `state?${new URLSearchParams({ summary: '1', panel, ...(record ? { entryId: record.id } : {}) })}`,
    );
    if(current())setState(data);
    return data;
  }
  const publicationController = usePublication(refresh, setError, notify);
  const { busy, job, setJob, setPublication, task } = publicationController;
  const workspace = useContentWorkspace({
    state,
    setState,
    tab,
    compact,
    busy,
    setError,
    notify,
    refresh,
    setJob,
    task,
  });
  const { record } = workspace;
  const focusedWriting = tab === 'content' && record?.value.kind === 'content';
  async function saveSiteSettings(value: any, revision: number) {
    const row = await api('settings', { value, revision });
    await refresh();
    return row;
  }
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)'),
      update = () => {
        setCompact(media.matches);
        setMenu(false);
      };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (session?.authenticated) refresh().catch((error) => setError(error.message));
  }, [session]);
  const pendingSchedule = state?.schedules?.some((row: any) => row.value.status === 'scheduled');
  useEffect(() => {
    if (!pendingSchedule) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const schedules = await api(
          workspace.session.record
            ? `schedules?entryId=${encodeURIComponent(workspace.session.record!.id)}`
            : 'schedules',
        );
        if (active) setState((old: any) => ({ ...old, schedules }));
      } catch (error: any) {
        if (active) setError(error.message);
      } finally {
        if (active) timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingSchedule]);
  async function navigate(next: string, recordHistory = true) {
    const version=++navigationVersion.current;
    ++workspace.selection.current;
    try {
      await editors.flush();
      if(version!==navigationVersion.current)return true;
      workspace.clear();
      await refresh(next,()=>version===navigationVersion.current);
      if(version!==navigationVersion.current)return true;
      setTab(next);
      setMenu(false);
      if (recordHistory && next !== tab) window.history.pushState(null, '', panelUrl(window.location.href, next));
      return true;
    } catch (error: any) {
      if(version!==navigationVersion.current)return true;
      setError(error.message);
      return false;
    }
  }
  useEffect(() => {
    const back = async () => {
      const next = adminPanel(window.location.search);
      if (next !== tab && !await navigate(next, false))
        window.history.replaceState(null, '', panelUrl(window.location.href, tab));
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [tab, session]);
  async function logout() {
    try {
      await editors.flush();
      workspace.clear();
      await api('logout', {});
      authentication.setSession(await api('session'));
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
      logout={logout}
    />
  );
  return (
    <FieldWidgetsProvider value={state?.fieldWidgets ?? {}}>
      <div className={'app' + (focusedWriting ? ' writing-focus' : '')}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {!focusedWriting && (compact ? (
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
          {compact && !focusedWriting && <header className="topbar">
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
              <strong className="breadcrumb-current">{tabs.find((t) => t[0] === tab)?.[1]}</strong>
            </div>
          </header>}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')}>关闭</button>
            </div>
          )}
          {job && (
            <div className={'job-banner ' + job.status} role="status">
              {busy && <Loader2 className="spin" size={15} />}
              <span>{job.message}</span>
              <button onClick={() => setLogJob(job.id)}>查看日志</button>
              {!busy && <button onClick={() => setJob(null)}>关闭</button>}
            </div>
          )}
          {!state ? (
            <div className="loading-screen">正在载入…</div>
          ) : (
            <Suspense fallback={<p role="status">正在载入…</p>}>
              {tab === 'content' && (
                <div className={'content-workspace' + (record ? ' has-record' : '')}>
                  {record ? <EntryEditor model={workspace} /> : <ContentLibrary model={workspace} />}
                </div>
              )}
              {tab === 'media' && (
                <Suspense fallback={<p>正在载入媒体…</p>}>
                  <MediaManager
                    onError={setError}
                    onOpen={(id) => {
                      api(`entry/${encodeURIComponent(id)}`)
                        .then(async (row) => {
                          if (row.value.kind === 'page') await navigate('appearance');
                          else if (await navigate('content')) await workspace.select(id);
                        })
                        .catch((error) => setError(error.message));
                    }}
                  />
                </Suspense>
              )}
              {tab === 'appearance' && (
                <SettingsPanel
                  row={state.settings}
                  themes={state.themes ?? []}
                  panels={state.extensionPanels ?? []}
                  layouts={state.layouts ?? []}
                  publish={() => task('publish', { scope: 'settings' }, true)}
                  pendingApplication={state.settingsPending || state.termsPending}
                  save={saveSiteSettings}
                  onError={setError}
                  siteInfo={state.siteInfo}
                  terms={state.terms ?? []}
                  refresh={refresh}
                  initialSection={new URLSearchParams(window.location.search).get('panel') === 'terms' ? 'navigation' : undefined}
                />
              )}
              {tab === 'analytics' && <AnalyticsPanel onError={setError} />}
              {tab === 'search-tools' && (
                <Suspense fallback={<p>正在载入检查…</p>}>
                  <SearchTools />
                </Suspense>
              )}
              {tab === 'comments' && (
                <Suspense fallback={<p>加载中…</p>}>
                  <Comments settings={state.settings} saveSettings={saveSiteSettings} pendingApplication={state.settingsPending || state.termsPending}
                    publishSettings={() => task('publish', { scope: 'settings' }, true)} onError={setError} />
                </Suspense>
              )}
              {tab === 'redirects' && (
                <Suspense fallback={<p>加载中…</p>}>
                  <RedirectManager
                    onError={setError}
                    publish={() => task('publish', { scope: 'routes' })}
                  />
                </Suspense>
              )}
              {tab === 'account' && <Suspense fallback={<p>正在读取账户…</p>}><AccountPanel sessionGeneration={authentication.sessionGeneration} setError={setError} notify={notify} /></Suspense>}
              {tab === 'operations' && (
                <Operations
                  state={state}
                  task={task}
                  refresh={async () => {
                    await refresh();
                  }}
                  onError={setError}
                  openLogs={setLogJob}
                />
              )}
            </Suspense>
          )}
        </main>

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        <PublicationDialog
          model={publicationController}
          error={error}
          onPublished={async () => {
            if (workspace.session.record) await workspace.select(workspace.session.record.id);
          }}
        />
        {logJob && <JobLogs key={logJob} id={logJob} onClose={() => setLogJob(null)} />}
        <Reauthentication
          model={authentication}
          setError={setError}
          dirty={workspace.dirty}
          onAuthenticated={async () => {
            setPublication(null);
            await editors.flush();
          }}
        />
        <ContentDialogs model={workspace} />
      </div>
    </FieldWidgetsProvider>
  );
}
