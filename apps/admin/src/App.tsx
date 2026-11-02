import { useState, useEffect, useRef, lazy, Suspense } from 'react';

import { ArrowUpRight, Menu, Loader2 } from 'lucide-react';

import { api } from './api.ts';

import { FieldWidgetsProvider } from './Fields.tsx';

import { Dialog } from './Dialog.tsx';
import { JobLogs } from './JobLogs.tsx';
import { useEditSessions } from './EditSessions.tsx';

import './style.css';

import TypeManager from './TypeManager.tsx';
import SettingsPanel from './SettingsPanel.tsx';
import Operations from './Operations.tsx';
import { AdminNavigation, tabs } from './AdminNavigation.tsx';
import { adminPanel, panelUrl } from './admin-location.ts';
import { useAdminSession } from './useAdminSession.ts';
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
const PublicationPlans = lazy(() => import('./PublicationPlans.tsx'));
const Comments = lazy(() => import('./Comments.tsx'));

const LayoutManager = lazy(() => import('./LayoutManager.tsx'));
const MediaManager = lazy(() => import('./MediaManager.tsx'));

const TaxonomyManager = lazy(() => import('./TaxonomyManager.tsx'));

export function App() {
  const editors = useEditSessions();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [tab, setTab] = useState(() => adminPanel(window.location.search)),
    [state, setState] = useState<any>(null),
    [logJob, setLogJob] = useState<string | null>(null),
    [menu, setMenu] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationVersion=useRef(0);
  const authentication = useAdminSession(setError),
    { session } = authentication;
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
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)'),
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
      <div className="app">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {compact ? (
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
        )}
        <main className="main-shell" id="main-content" tabIndex={-1}>
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
              <strong className="breadcrumb-current">{tabs.find((t) => t[0] === tab)?.[1]}</strong>
            </div>
            <a href="/" target="_blank" className="view-site" aria-label="打开网站">
              打开网站
              <ArrowUpRight size={14} />
            </a>
          </header>
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
            <>
              {['content', 'pages'].includes(tab) && (
                <div className={'content-workspace' + (record ? ' has-record' : '')}>
                  <ContentLibrary model={workspace} />
                  <EntryEditor model={workspace} />
                </div>
              )}
              {tab === 'layouts' && (
                <Suspense fallback={<p>正在载入布局…</p>}>
                  <LayoutManager
                    catalog={state}
                    refresh={refresh}
                    publish={() => task('publish', { scope: 'layouts' })}
                    onError={setError}
                  />
                </Suspense>
              )}
              {tab === 'terms' && (
                <Suspense fallback={<p>正在载入分类…</p>}>
                  <TaxonomyManager
                    rows={state.terms ?? []}
                    refresh={refresh}
                    publish={() => task('publish', { scope: 'terms' })}
                    onError={setError}
                  />
                </Suspense>
              )}
              {tab === 'types' && (
                <TypeManager
                  types={state.types}
                  extensionBlocks={state.extensionBlocks ?? []}
                  templates={state.layouts ?? []}
                  onSave={async (value, revision) => {
                    const row = await api('types', { value, revision });
                    await refresh();
                    notify('内容类型已保存');
                    return row;
                  }}
                  onError={setError}
                />
              )}
              {tab === 'media' && (
                <Suspense fallback={<p>正在载入媒体…</p>}>
                  <MediaManager
                    onError={setError}
                    onOpen={(id) => {
                      api(`entry/${encodeURIComponent(id)}`)
                        .then(async (row) => {
                          if (await navigate(row.value.kind === 'page' ? 'pages' : 'content'))
                            await workspace.select(id);
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
                  publish={() => task('publish', { scope: 'settings' })}
                  save={async (value, revision) => {
                    const row = await api('settings', { value, revision });
                    await refresh();
                    notify('设置工作稿已保存');
                    return row;
                  }}
                  onError={setError}
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
                  <Comments onError={setError} />
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
              {tab === 'publication-plans' && (
                <Suspense fallback={<p>加载中…</p>}>
                  <PublicationPlans onError={setError} />
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
            </>
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
