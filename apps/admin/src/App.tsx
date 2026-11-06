import { useState, useEffect, useRef, Suspense } from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';

import { Menu, Loader2, Check } from 'lucide-react';

import { api } from './api.ts';
import { adminQueries } from './query-cache.ts';
import { useAdminQuery } from './useAdminQuery.ts';

import { FieldWidgetsProvider } from './Fields.tsx';

import { Dialog } from './Dialog.tsx';
import { JobLogs } from './JobLogs.tsx';
import { useEditSessions } from './EditSessions.tsx';

import './style.css';
import {isNoteType} from '@weava/contracts';
import {NoteEditor} from './NoteEditor.tsx';
import {NotesLibrary} from './NotesLibrary.tsx';

const panelModules = {
  appearance: () => import('./SettingsPanel.tsx'), operations: () => import('./Operations.tsx'),
  account: () => import('./AccountPanel.tsx'), analytics: () => import('./AnalyticsPanel.tsx'),
  comments: () => import('./Comments.tsx'), media: () => import('./MediaManager.tsx'),
};
const preloadPanel = (panel: string) => { const load = panelModules[panel as keyof typeof panelModules]; if (load) void load().catch(() => {}); };
const SettingsPanel=lazy(panelModules.appearance);
const Operations=lazy(panelModules.operations);
import { AdminNavigation, tabs } from './AdminNavigation.tsx';
import { adminPanel, panelUrl, entryUrl } from './admin-location.ts';
import type { AdminSession } from './useAdminSession.ts';
import { LoginScreen } from './LoginScreen.tsx';
import { Reauthentication } from './Reauthentication.tsx';
import { useContentWorkspace } from './useContentWorkspace.ts';
import { ContentLibrary } from './ContentLibrary.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { ContentDialogs } from './ContentDialogs.tsx';
import { usePublication } from './usePublication.ts';
import { useSettingsApplication } from './useSettingsApplication.ts';
import { PublicationDialog } from './PublicationDialog.tsx';
const AccountPanel = lazy(panelModules.account);
const AnalyticsPanel = lazy(panelModules.analytics);

const Comments = lazy(panelModules.comments);

const MediaManager = lazy(panelModules.media);
const statePath = (panel: string, entryId?: string) => `state?${new URLSearchParams({
  summary: '1', panel: ['appearance','comments','operations'].includes(panel) ? panel : 'content', ...(entryId ? { entryId } : {}),
})}`;

import { useTransientMessage } from './useTransientMessage.ts';
import {ErrorBoundary} from './ErrorBoundary.tsx';
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
  const navigationVersion=useRef(0),historyVersion=useRef(0);
  const { session } = authentication;
  const activeTab = useRef(tab), [statePanel, setStatePanel] = useState('');
  const panelPath = statePath(tab);
  const panelQuery = useAdminQuery(session?.authenticated ? panelPath : null);
  useEffect(() => { if (!session?.authenticated) { setState(null); setStatePanel(''); } }, [session?.authenticated]);
  function receiveState(data: any, panel: string) {
    setState(data); setStatePanel(panel);
    const required: Record<string, string> = { content: 'content', notes: 'content', media: 'media', comments: 'engagement', analytics: 'analytics' };
    if (data.features && required[panel] && !data.features.includes(required[panel])) {
      activeTab.current = 'appearance'; setTab('appearance'); history.replaceState(null, '', panelUrl(location.href, 'appearance'));
      return 'appearance';
    }
    return panel;
  }
  useEffect(() => { if (panelQuery.data) receiveState(panelQuery.data, tab); }, [panelQuery.data, tab]);
  useEffect(() => { if (panelQuery.error) setError(panelQuery.error); }, [panelQuery.error]);
  function notify(message: string, duration = 3000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), duration);
  }
  async function refresh(panel = activeTab.current, current = ()=>true) {
    const record = workspace.navigation.current();
    const path = statePath(panel, record?.id);
    const data = await adminQueries.read(path, () => api.request(path), true);
    if(current() && activeTab.current === panel) receiveState(data, panel);
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
    task,
  });
  const {record}=workspace.editor;
  const feedbackContext = tab + ':' + (record?.id ?? 'list');
  useTransientMessage(error, () => setError(''), feedbackContext);
  useTransientMessage(toast, () => setToast(''), feedbackContext, 3000);
  useTransientMessage(job && !busy ? job.id : '', () => setJob(null), feedbackContext);
  const siteLogo = state?.siteIcon ?? state?.settings.value.logo;
  useEffect(() => {
    if (siteLogo === undefined) return;
    let icon = document.head.querySelector<HTMLLinkElement>('link[data-weava-site-icon]');
    if (!siteLogo) { icon?.remove(); return; }
    if (!icon) {
      icon = document.createElement('link'); icon.rel = 'icon'; icon.dataset.weavaSiteIcon = '';
      document.head.append(icon);
    }
    icon.href = siteLogo;
  }, [siteLogo]);
  const settingsApplication = useSettingsApplication(refresh, () => notify('已保存并生效', 2600));
  useEffect(() => {
    if (state?.settingsPending || state?.termsPending) settingsApplication.resumePending();
  }, [state?.settingsPending, state?.termsPending, settingsApplication]);
  const focusedWriting = tab === 'content' && record?.value.kind === 'content';
  async function saveSiteSettings(value: any, revision: number) {
    const row = await api('settings', { value, revision });
    settingsApplication.request();
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
    if (!session?.authenticated || !panelQuery.data) return;
    let active = true;
    const version = navigationVersion.current;
    const entryId = ['content','notes'].includes(tab) ? new URLSearchParams(window.location.search).get('entry') : null;
    if (entryId && !workspace.navigation.current() && version === 0)
      workspace.navigation.select(entryId).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [session, !!panelQuery.data]);
  const pendingSchedule = state?.schedules?.some((row: any) => row.value.status === 'scheduled');
  useEffect(() => {
    if (!pendingSchedule) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const schedules = await api(
          workspace.navigation.current()
            ? `schedules?entryId=${encodeURIComponent(workspace.navigation.current()!.id)}`
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
    if(recordHistory)++historyVersion.current;
    if (next === activeTab.current) { ++navigationVersion.current; setMenu(false); return true; }
    preloadPanel(next);
    const version=++navigationVersion.current;
    workspace.navigation.cancelSelection();
    try {
      await editors.flush();
      if(version!==navigationVersion.current)return true;
      workspace.navigation.clear(false);
      activeTab.current = next;
      const cached = adminQueries.snapshot(statePath(next)).data;
      if (cached) next = receiveState(cached, next);
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
      const version=++historyVersion.current,href=window.location.href;
      const current=()=>version===historyVersion.current&&href===window.location.href;
      const next = adminPanel(window.location.search);
      const entryId=new URLSearchParams(window.location.search).get('entry');
      const restore=()=>window.history.replaceState(null,'',entryUrl(panelUrl(window.location.href,activeTab.current),workspace.navigation.current()?.id??null));
      try{
        if(next!==tab&&!await navigate(next,false)){if(current())restore();return;}
        if(!current())return;
        if(['content','notes'].includes(next)){
          if(entryId&&entryId!==workspace.navigation.current()?.id){await workspace.navigation.select(entryId,false);if(current()&&workspace.navigation.current()?.id!==entryId)restore();}
          else if(!entryId&&workspace.navigation.current()){await editors.flush();if(current())workspace.navigation.clear(false);}
        }
      }catch(error:any){if(current()){setError(error.message);restore();}}
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [tab, session]);
  async function logout() {
    try {
      await editors.flush();
      await api('logout', {});
      workspace.navigation.clear();
      authentication.setSession((current:any)=>current?{...current,authenticated:false}:current);
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
          {job && tab!=='notes' && (
            <div className={'job-banner ' + job.status} role="status">
              {busy && <Loader2 className="spin" size={15} />}
              <span>{job.message}</span>
              <button onClick={() => setLogJob(job.id)}>查看日志</button>
              {!busy && <button onClick={() => setJob(null)}>关闭</button>}
            </div>
          )}
          {!state || ['appearance','operations'].includes(tab) && statePanel !== tab ? (
            <div className="loading-screen">{panelQuery.error ? <button onClick={() => void panelQuery.refresh().catch(() => {})}>重新载入</button> : '正在载入…'}</div>
          ) : (
            <ErrorBoundary resetKey={tab} onReload={async()=>{await editors.preserve();window.location.reload();}}><Suspense fallback={<p role="status">正在载入…</p>}>
              {['content','notes'].includes(tab) && (
                <div className={'content-workspace' + (record&&tab!=='notes' ? ' has-record' : '')}>
                  {tab==='notes'?<><NotesLibrary model={workspace.library}/>{record&&isNoteType(state.types.find((row:any)=>row.id===record.value.type)?.value)&&<NoteEditor model={workspace.editor} error={error}/>}</>:record?<EntryEditor model={workspace.editor}/>:<ContentLibrary model={workspace.library}/>}
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
                          else if (await navigate(isNoteType(state.types.find((type:any)=>type.id===row.value.type)?.value)?'notes':'content')) await workspace.navigation.select(id);
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
                  initialSection={new URLSearchParams(window.location.search).get('panel') === 'terms' ? 'navigation' : undefined}
                />
              )}
              {tab === 'analytics' && <AnalyticsPanel onError={setError} timezone={state.settings.value.timezone} />}
              {tab === 'comments' && (
                <Suspense fallback={<p>加载中…</p>}>
                  <Comments settings={state.settings} saveSettings={saveSiteSettings}
                    application={settingsApplication.state} onError={setError} />
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
            </Suspense></ErrorBoundary>
          )}
        </main>

        {error && !publicationController.publication && !(tab==='notes'&&record) ? (
          <div className="toast error-toast" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}>×</button></div>
        ) : toast && (
          <div className="toast" role="status" aria-live="polite" aria-atomic="true">
            <Check size={17} strokeWidth={2} aria-hidden="true" /><span>{toast}</span>
          </div>
        )}
        <PublicationDialog
          model={publicationController}
          error={error}
          onPublished={async () => {
            const row=workspace.navigation.current();if(row)await workspace.navigation.select(row.id);
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
