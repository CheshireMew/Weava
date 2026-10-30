import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FileText,
  ArrowLeft,
  X,
  PanelsTopLeft,
  Images,
  Palette,
  ChartNoAxesCombined,
  Settings2,
  Shapes,
  ArrowUpRight,
  Plus,
  Search,
  LogOut,
  Menu,
  Check,
  Loader2,
  History,
  Eye,
  Upload,
  Archive,
  MessageSquare,
} from 'lucide-react';
import {
  entrySchema,
  blockDefinitions,
  schemaTypes,
  defaultSettings,
  type Entry,
  type FieldDefinition,
  type ContentType,
  type Settings,
  type Revision,
} from '@weava/contracts';
import { api, waitJob } from './api.ts';
import { localDrafts, saveLocalDraft, forgetLocalDrafts, acknowledgeLocalDrafts, type LocalDraft } from './local-drafts.ts';
import { Blocks } from './Blocks.tsx';
import { NavigationEditor } from './NavigationEditor.tsx';
import { TermPicker } from './TermPicker.tsx';
import { SelectorsProvider, useSelectors } from './Selectors.tsx';
import { SavedViewControls, SaveCreationTemplate, ChooseCreationTemplate } from './AuthoringControls.tsx';
import { Fields, FieldDefinitions, TypeAdminLayout, FieldWidgetsProvider } from './Fields.tsx';
import { EditorialFields } from './EditorialFields.tsx';
import { Dialog } from './Dialog.tsx';
import { useDebouncedValue } from './useDebouncedValue.ts';
import './style.css';
import { SeoFields, SiteSeoFields } from './SeoFields.tsx';
const SearchTools = lazy(() => import('./SearchTools.tsx'));
const AnalyticsPanel = lazy(() => import('./AnalyticsPanel.tsx'));
const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));
const BulkEditor = lazy(() => import('./BulkEditor.tsx'));
const RedirectManager = lazy(() => import('./RedirectManager.tsx'));
const PublicationPlans = lazy(() => import('./PublicationPlans.tsx'));
const Comments = lazy(() => import('./Comments.tsx'));
const PageDesigner = lazy(() => import('./PageDesigner.tsx').then((module) => ({ default: module.PageDesigner })));
const LayoutManager = lazy(() => import('./LayoutManager.tsx'));
const MediaManager = lazy(() => import('./MediaManager.tsx'));
const ImportManager = lazy(() => import('./ImportManager.tsx'));
const ExtensionManager = lazy(() => import('./ExtensionManager.tsx'));
const TaxonomyManager = lazy(() => import('./TaxonomyManager.tsx'));
const HistoryMaintenance = lazy(() => import('./HistoryMaintenance.tsx'));
const RevisionDialog = lazy(() => import('./Revisions.tsx').then((module) => ({ default: module.RevisionDialog })));
const MergeDialog = lazy(() => import('./Revisions.tsx').then((module) => ({ default: module.MergeDialog })));
const tabs = [
  ['content', '内容', FileText],
  ['pages', '页面', PanelsTopLeft],
  ['layouts', '布局', PanelsTopLeft],
  ['types', '内容类型', Shapes],
  ['terms', '分类与标签', Shapes],
  ['media', '媒体', Images],
  ['comments', '评论', MessageSquare],
  ['redirects', '网址别名', ArrowUpRight],
  ['publication-plans', '发布计划', Check],
  ['appearance', '外观与导航', Palette],
  ['analytics', '访问统计', ChartNoAxesCombined],
  ['search-tools', '搜索与检查', Search],
  ['operations', '运行与备份', Settings2],
] as const;
function App() {
  const selectors = useSelectors();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [loginPending, setLoginPending] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => { setCompact(media.matches); setMenu(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const [session, setSession] = useState<any>(null),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [tab, setTab] = useState('content'),
    [state, setState] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<any>(null),
    [menu, setMenu] = useState(false);
  const [record, setRecord] = useState<Revision<Entry> | null>(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [filter, setFilter] = useState(''),
    [status, setStatus] = useState('all'),
    [visibility, setVisibility] = useState('all'),
    [preview, setPreview] = useState(''),
    [narrow, setNarrow] = useState(false),
    [history, setHistory] = useState<any[] | null>(null),
    [restoreLocal, setRestoreLocal] = useState<any>(null);
  const searchTerm = useDebouncedValue(filter);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [recoveryCopies, setRecoveryCopies] = useState<LocalDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState('');
  const [reauth, setReauth] = useState(false), [reauthPassword, setReauthPassword] = useState(''), [reauthError, setReauthError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false), reauthLater = useRef(false);
  useEffect(() => { const expire = () => { setSessionExpired(true); if (!reauthLater.current) setReauth(true); }; window.addEventListener('weava-session-expired', expire); return () => window.removeEventListener('weava-session-expired', expire); }, []);
  const forgetDraft = (id: string) => { try { forgetLocalDrafts(id); } catch (error: any) { setDraftNotice(error.message || '无法更新浏览器草稿。'); } };

  const [conflict, setConflict] = useState<any>(null), [conflictPaused, setConflictPaused] = useState(false);
  const paused = useRef(false);
  const childSave = useRef<(() => Promise<any>) | null>(null);
  const [publication, setPublication] = useState<any>(null);
  const [contentCheck, setContentCheck] = useState<any>(null);
  useEffect(() => { setContentCheck(null); }, [record?.id]);
  const [scheduleDueAt, setScheduleDueAt] = useState('');
  const [libraryPage, setLibraryPage] = useState(1);
  const [library, setLibrary] = useState<any>({ items: [], total: 0, pages: 0 });
  const [libraryType, setLibraryType] = useState('');
  const [librarySort, setLibrarySort] = useState('');
  const [bulkIds, setBulkIds] = useState<string[]>([]), [bulkOpen, setBulkOpen] = useState(false);
  const [creating, setCreating] = useState<{ kind: Entry['kind']; type: string } | null>(null);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  useEffect(() => { setBulkIds([]); }, [filter, libraryPage, libraryType, librarySort, fieldFilters, tab, status, visibility]);
  useEffect(() => {
    if (!compact || !record) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="内容标题"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [compact, record?.id]);
  const current = useRef(record),
    saved = useRef(''),
    running = useRef<Promise<any> | null>(null),
    errorRef = useRef('');
  current.current = record;
  const notify = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  };
  async function refresh() {
    const data = await api('state?summary=1');
    setState(data);
    return data;
  }
  useEffect(() => {
    api('session')
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (session?.authenticated) refresh().catch((e) => setError(e.message));
  }, [session]);
  useEffect(() => { setLibraryPage(1); }, [tab, filter, status, visibility, libraryType, fieldFilters]);
  useEffect(() => { setLibraryType(''); setFieldFilters({}); }, [tab]);
  const pendingSchedule = state?.schedules?.some((row: any) => row.value.status === 'scheduled');
  useEffect(() => {
    if (!pendingSchedule) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const schedules = await api('schedules'); if (active) setState((old: any) => ({ ...old, schedules })); }
      catch (error: any) { if (active) setError(error.message); }
      finally { if (active) timer = setTimeout(poll, 5000); }
    };
    timer = setTimeout(poll, 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [pendingSchedule]);
  useEffect(() => {
    if (!state || !['content', 'pages'].includes(tab)) return;
    let active = true;
    setLibraryLoading(true);
    const params = new URLSearchParams({ kind: tab === 'pages' ? 'page' : 'content', q: searchTerm, status, visibility,
      type: tab === 'content' ? libraryType : '', page: String(libraryPage), pageSize: '25', sort: librarySort || state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || 'title', ...Object.fromEntries(Object.entries(fieldFilters).filter(([,value]) => value !== '').map(([key,value]) => ['field.' + key,value])) });
    api(`entries/query?${params}`).then((result) => { if (active) setLibrary(result); }).catch((error) => { if (active) setError(error.message); }).finally(() => { if (active) setLibraryLoading(false); });
    return () => { active = false; };
  }, [state, tab, searchTerm, status, visibility, libraryType, libraryPage, fieldFilters, librarySort]);
  async function persist(): Promise<any> {
    if (running.current) {
      await running.current;
      return persist();
    }
    const row = current.current;
    if (!row || JSON.stringify(row.value) === saved.current) return row;
    if (paused.current) { await showConflict(row); throw new Error('请先处理保存冲突。'); }
    const snapshot = structuredClone(row);
    setSaving(true);
    const task = api('entry', { value: snapshot.value, revision: snapshot.revision || null })
      .then((result) => {
        saved.current = JSON.stringify(snapshot.value);
        setLibrary((old: any) => ({ ...old, items: old.items.map((item: any) => item.id === result.id ? { ...item, revision: result.revision, updatedAt: result.updatedAt, hasChanges: true, value: { ...item.value, title: result.value.title, description: result.value.description, fields: result.value.fields } } : item) }));
        if (current.current?.id === snapshot.id) {
          const unchanged =
            JSON.stringify(current.current.value) === JSON.stringify(snapshot.value);
          const next = { ...result, value: unchanged ? result.value : current.current.value };
          if (unchanged) saved.current = JSON.stringify(result.value);
          current.current = next;
          setRecord(next);
          setDirty(!unchanged);
          if (unchanged) { try { acknowledgeLocalDrafts(snapshot.id); setDraftNotice(''); } catch (error: any) { setDraftNotice(error.message); } setRecoveryCopies([]); }
        }
        return result;
      })
      .catch(async (e) => {
        setError(e.message);
        errorRef.current = e.message;
        if (e.status === 409 && snapshot.revision) await showConflict(current.current ?? snapshot).catch((error) => setError(error.message));
        throw e;
      })
      .finally(() => {
        running.current = null;
        setSaving(false);
      });
    running.current = task;
    const result = await task;
    if (
      current.current?.id === snapshot.id &&
      JSON.stringify(current.current.value) !== saved.current
    )
      return persist();
    return result;
  }
  useEffect(() => {
    if (!dirty || !record) return;
    try {
      saveLocalDraft(record); setDraftNotice('');
    } catch (error: any) { setDraftNotice(error.message || '浏览器无法保存本地草稿，请保持页面打开并保存到网站。'); }
    if (conflictPaused) return;
    const timer = setTimeout(() => persist().catch(() => {}), 1200);
    return () => clearTimeout(timer);
  }, [record, dirty, conflictPaused]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        try { if (current.current) saveLocalDraft(current.current); } catch {}
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        persist().catch(() => {});
      }
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('keydown', key);
    };
  }, [dirty]);
  function update(patch: Partial<Entry>) {
    setContentCheck(null);
    setRecord((old) => (old ? { ...old, value: { ...old.value, ...patch } } : old));
    setDirty(true);
  }
  async function showConflict(row: Revision<Entry>) {
    paused.current = true; setConflictPaused(true);
    const plan = await api('entry/merge', { id: row.id, baseRevision: row.revision, value: row.value });
    setConflict(plan);
  }
  function adopt(row: Revision<Entry>) {
    current.current = row; saved.current = JSON.stringify(row.value);
    setRecord(row); setDirty(false); setEditorEpoch((value) => value + 1);
    paused.current = false; setConflictPaused(false); setConflict(null); setRestoreLocal(null);
    forgetDraft(row.id); setError(''); errorRef.current = '';
  }
  async function select(id: string) {
    try {
      await persist();
      const row = await api(`entry/${encodeURIComponent(id)}`);
      setRecord(row);
      setEditorEpoch((v) => v + 1);
      current.current = row;
      saved.current = JSON.stringify(row.value);
      setDirty(false);
      setPreview('');
      setHistory(null);
      try {
        const copies = localDrafts(id).filter((copy) => copy.pending !== false && JSON.stringify(copy.record.value) !== JSON.stringify(row.value));
        setRecoveryCopies(copies); setRestoreLocal(copies[0]?.record ?? null);
      } catch (error: any) { setDraftNotice(error.message || '无法读取浏览器草稿。'); }
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function navigate(next: string) {
    try {
      await childSave.current?.();
      await persist();
      setTab(next);
      setMenu(false);
      setRecord(null);
      current.current = null;
      setPreview('');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function createNew(kind: Entry['kind'], type: string, templateId?: string) {
    const row = await api('entries/create', { kind, type, templateId });
    await refresh(); setRecord(row); current.current = row; saved.current = JSON.stringify(row.value);
    setDirty(false); setPreview(''); setFilter(''); setStatus('all'); setLibraryType(kind === 'content' ? type : '');
  }
  async function newEntry() {
    try {
      await persist();
      const kind = tab === 'pages' ? 'page' : 'content', type = libraryType || state.types[0]?.value.id || 'post';
      if (state.creationTemplates?.some((row: any) => row.value.kind === kind && (kind === 'page' || row.value.type === type))) { setCreating({ kind, type }); return; }
      await createNew(kind, type);
    } catch (error: any) { setError(error.message); }
  }
  async function task(operation: 'publish' | 'backup' | 'verify', payload: any = {}, reviewed = false) {
    setBusy(true);
    setError('');
    try {
      if (operation === 'publish' && !reviewed) {
        const review = await api('publication', payload);
        setPublication(review);
        return review;
      }
      const result = await waitJob(await api(operation, payload), setJob);
      await refresh();
      notify('操作已完成');
      return result;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
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
  if (!session) return <main className="loading-screen">
    <h1>Weava</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => { setError(''); api('session').then(setSession).catch((error) => setError(error.message)); }}>重新连接</button></> : <p role="status">正在连接网站…</p>}
  </main>;
  if (!session.authenticated)
    return (
      <main className="login">
        <div className="login-brand">w</div>
        <h1>回到你的空间。</h1>
        <p>
          {session.initialized
            ? '登录 Weava，继续创造。'
            : '请通过初始化命令或密码恢复命令设置站主密码。'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loginPending) return;
            setLoginPending(true);
            setError('');
            try {
              await api('login', { password });
              setSession(await api('session'));
              setError('');
            } catch (e: any) {
              setError(e.message);
            } finally { setLoginPending(false); }
          }}
          aria-busy={loginPending}
        >
          <label>
            站主密码
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={!session.initialized || loginPending}>
            {loginPending ? '正在登录…' : '进入网站'}
          </button>
        </form>
        {error && <p className="error" role="alert" id="login-error">{error}</p>}
        <a href="/">查看网站 ↗</a>
      </main>
    );
  const items = library.items;
  const navigation = <>
        {compact && <button className="mobile-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}><X size={20} /></button>}
        <a className="app-brand" href="/admin/">
          <span>w</span>Weava
        </a>
        <div className="site-name">{state?.settings.value.name ?? '你的网站'}</div>
        <nav aria-label="网站管理">
          {tabs.map(([key, label, Icon]) => (
            <button aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} key={key} onClick={() => navigate(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank">
            查看网站
            <ArrowUpRight size={16} />
          </a>
          <button
            onClick={async () => {
              await persist();
              await api('logout', {});
              setSession(await api('session'));
            }}
          >
            <LogOut size={16} />
            退出
          </button>
        </div>

  </>;
  return (
    <FieldWidgetsProvider value={state?.fieldWidgets ?? {}}>
    <div className="app">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {compact ? menu && <Dialog className="sidebar mobile-sidebar" label="网站管理" onClose={() => setMenu(false)}>{navigation}</Dialog> : <aside className="sidebar">{navigation}</aside>}
      <main className="main-shell" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-label="打开菜单" aria-expanded={menu} aria-haspopup="dialog">
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
            <button
              onClick={async () => {
                const logs = await api(`logs?id=${job.id}`);
                setError(logs.text || '任务暂无日志');
              }}
            >
              查看日志
            </button>
            {!busy && <button onClick={() => setJob(null)}>关闭</button>}
          </div>
        )}
        {!state ? (
          <div className="loading-screen">正在载入…</div>
        ) : (
          <>
            {['content', 'pages'].includes(tab) && (
              <div className={'content-workspace' + (record ? ' has-record' : '')}>
                <section className="library" aria-label="内容列表" tabIndex={-1}>
                  <div className="library-header">
                    <div>
                      <h1>{tab === 'pages' ? '页面' : '内容'}</h1>
                      <span>{library.total} 项</span>
                    </div>
                    <button className="icon-primary" aria-label="新建" onClick={newEntry}>
                      <Plus size={19} />
                    </button>
                  </div>
                  <div className="library-search">
                    <Search size={15} />
                    <input
                      aria-label="搜索内容"
                      placeholder="搜索标题或摘要"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="内容状态"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">全部状态</option>
                    <option value="published">已发布</option>
                    <option value="changed">有未发布修改</option>
                    <option value="draft">草稿</option>
                    <option value="archived">已归档</option>
                  </select>
                  <select aria-label="内容可见性" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                    <option value="all">全部可见性</option>
                    <option value="public">公开</option>
                    <option value="private">私密</option>
                  </select>
                  {tab === 'content' && <select aria-label="筛选内容类型" value={libraryType} onChange={(event) => { setLibraryType(event.target.value); setFieldFilters({}); setLibrarySort(''); }}><option value="">全部类型</option>{state.types.map((type: any) => <option key={type.id} value={type.id}>{type.value.label}</option>)}</select>}
                  {tab === 'content' && state.types.find((row: any) => row.id === libraryType)?.value.fields.filter((field: FieldDefinition) => field.filterable).map((field: FieldDefinition) => <label className="library-field-filter" key={field.key}>{field.label}{field.type === 'select' || field.type === 'boolean' ? <select aria-label={'筛选' + field.label} value={fieldFilters[field.key] ?? ''} onChange={(event) => setFieldFilters({ ...fieldFilters, [field.key]: event.target.value })}><option value="">全部</option>{(field.type === 'boolean' ? ['true','false'] : field.options ?? []).map((option) => <option key={option} value={option}>{field.type === 'boolean' ? option === 'true' ? '是' : '否' : option}</option>)}</select> : <input aria-label={'筛选' + field.label} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={fieldFilters[field.key] ?? ''} onChange={(event) => setFieldFilters({ ...fieldFilters, [field.key]: event.target.value })} />}</label>)}
                  <select aria-label="内容排序" value={librarySort || state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || 'title'} onChange={(event) => { setLibrarySort(event.target.value); setLibraryPage(1); }}>{Object.entries({ title: '标题升序', '-title': '标题降序', '-updatedAt': '最近修改', '-publishedAt': '最近发布', oldest: '最早发布' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                  <SavedViewControls key={tab} views={state.contentViews ?? []} query={{ kind: tab === 'pages' ? 'page' : 'content', type: libraryType || undefined, query: filter || undefined, status: status as any, visibility: visibility as any, fields: fieldFilters, sort: (librarySort || state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || 'title') as any }} apply={(query) => { setFilter(query.query ?? ''); setStatus(query.status ?? 'all'); setVisibility(query.visibility ?? 'all'); setLibraryType(query.type ?? ''); setFieldFilters(Object.fromEntries(Object.entries(query.fields ?? {}).map(([key, value]) => [key, String(value)]))); setLibrarySort(query.sort ?? ''); setLibraryPage(1); }} refresh={async () => { await refresh(); }} onError={setError} />
                  {bulkIds.length > 0 && <button onClick={async () => { try { await persist(); setBulkOpen(true); } catch (error: any) { setError(error.message); } }}>批量编辑（{bulkIds.length}）</button>}
                  <div className="entry-list" aria-busy={libraryLoading}>
                    {libraryLoading && <p className="library-status" role="status">正在查找内容…</p>}
                    {!libraryLoading && !items.length && <p className="library-status" role="status">{filter || status !== 'all' || visibility !== 'all' || libraryType ? '没有符合筛选条件的内容。' : '还没有内容，可以新建第一篇。'}</p>}
                    {items.map((r: any) => (
                      <React.Fragment key={r.id}><label className="entry-selection"><input type="checkbox" disabled={libraryLoading || filter !== searchTerm} aria-label={'批量选择 ' + r.value.title} checked={bulkIds.includes(r.id)} onChange={(event) => setBulkIds((ids) => event.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id))} /></label><button
                        key={r.id}
                        aria-current={record?.id === r.id ? 'true' : undefined}
                        className={record?.id === r.id ? 'selected' : ''}
                        onClick={() => select(r.id)}
                      >
                        <div>
                          {(state.types.find((type: any) => type.id === r.value.type)?.value.admin?.columns ?? ['status']).includes('status') && <>
                          <span className={'status-dot ' + (r.published ? 'published' : '')} />
                          <span>
                            {r.published
                              ? r.hasChanges
                                ? '已修改'
                                : '已发布'
                              : r.value.status === 'archived'
                                ? '已归档'
                                : '草稿'}
                          </span>
                          </>}
                          {!state.types.find((type: any) => type.id === r.value.type)?.value.admin?.columns && <time>
                            {new Date(r.updatedAt).toLocaleDateString('zh-CN', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </time>}
                        </div>
                        <h2>{r.value.title}</h2>
                        {state.types.find((type: any) => type.id === r.value.type)?.value.admin?.columns?.filter((key: string) => !['title', 'status'].includes(key)).map((key: string) => {
                          const field = state.types.find((type: any) => type.id === r.value.type)?.value.fields.find((field: any) => field.key === key);
                          const value = key === 'updatedAt' ? r.updatedAt : key === 'publishedAt' ? r.value.publishedAt : r.value.fields?.[key];
                          return <span className="entry-custom-column" key={key}>{field?.label ?? (key === 'updatedAt' ? '修改时间' : '发布时间')}：{Array.isArray(value) ? value.length + ' 项' : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? '字段组' : String(value ?? '—')}</span>;
                        })}
                        {r.value.visibility === 'private' && <span>私密</span>}
                        <p>{r.value.description || r.value.path}</p>
                      </button></React.Fragment>
                    ))}
                  </div>
                  {library.pages > 1 && <nav className="library-pagination" aria-label="内容列表分页"><button disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)}>上一页</button><span>{libraryPage} / {library.pages}</span><button disabled={libraryPage >= library.pages} onClick={() => setLibraryPage((page) => page + 1)}>下一页</button></nav>}
                </section>
                <section className="editing-area">
                  {!record ? (
                    <div className="empty-state">
                      <div className="empty-mark" aria-hidden="true"><FileText size={44} strokeWidth={1.4} /></div>
                      <h2>{tab === 'pages' ? '组织你的页面。' : '从一个想法开始。'}</h2>
                      <p>选择现有内容，或创建新的开始。</p>
                      <button className="primary" onClick={newEntry}>
                        <Plus size={16} />
                        新建{tab === 'pages' ? '页面' : '内容'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="editor-bar">
                        <button className="editor-back" aria-label="返回内容列表" onClick={async () => {
                          try { await persist(); current.current = null; setRecord(null); setDirty(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('.library')?.focus({ preventScroll: true })); }
                          catch (error: any) { setError(error.message); }
                        }}><ArrowLeft size={16} />返回列表</button>
                        <span className={'save-status' + (dirty ? ' unsaved' : '')} role="status">
                          {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{' '}
                          {saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
                        </span>
                        <div>
                          <button
                            title="历史版本"
                            aria-label="历史版本"
                            onClick={async () => {
                              try{await persist();setHistory(await api(`history?id=${record.id}`));}catch(error:any){setError(error.message);}
                            }}
                          >
                            <History size={16} />
                          </button>
                          <button
                            onClick={async () => {
                              try{const row = await persist();setPreview('/__preview/' + record.id + '?revision=' + row.revision);}catch(error:any){setError(error.message);}
                            }}
                          >
                            <Eye size={16} />
                            预览
                          </button>
                          <button onClick={() => { try { const copies = localDrafts(record.id); setRecoveryCopies(copies); setRestoreLocal(copies[0]?.record ?? null); if (!copies.length) notify('没有本地副本。'); } catch (error: any) { setDraftNotice(error.message); } }}>本地副本</button>
                          <button disabled={busy || saving} onClick={async () => { try { const result = await api('entry/check', { value: current.current!.value }); setContentCheck({ ...result, id: record.id }); } catch (error: any) { setError(error.message); } }}>检查</button>
                          <button className="primary" disabled={busy || saving} onClick={()=>publish().catch((error)=>setError(error.message))}>
                            发布
                          </button>
                        </div>
                      </div>
                      {draftNotice && <div className="recovery-banner" role="alert">{draftNotice}</div>}
                      {conflictPaused && <div className="recovery-banner">本地修改尚未保存，服务器已有新版本。<button onClick={() => { if (current.current) showConflict(current.current).catch((error) => setError(error.message)); }}>比较并解决</button></div>}
                      {restoreLocal && (
                        <div className="recovery-banner">
                          浏览器保留了{recoveryCopies.length || 1}份未保存内容。
                          {recoveryCopies.length > 1 && <select aria-label="选择本地草稿" value={recoveryCopies.find((copy) => copy.record === restoreLocal)?.id ?? recoveryCopies[0].id} onChange={(event) => setRestoreLocal(recoveryCopies.find((copy) => copy.id === event.target.value)!.record)}>{recoveryCopies.map((copy) => <option key={copy.id} value={copy.id}>{copy.updatedAt ? new Date(copy.updatedAt).toLocaleString() : '此前保存'} · {copy.record.value.title}</option>)}</select>}
                          <button
                            onClick={async () => {
                              const local = restoreLocal;
                              try { saveLocalDraft(local, localStorage, Date.now(), true); } catch (error: any) { setDraftNotice(error.message); }
                              if (local.revision !== record.revision) {
                                current.current = local; setRecord(local); setDirty(true);
                                await showConflict(local).catch((error) => setError(error.message));
                              } else update(local.value);
                              setEditorEpoch((v) => v + 1);
                              setRestoreLocal(null);
                            }}
                          >
                            恢复到编辑器
                          </button>
                          <button
                            onClick={async () => {
                              try { const server = await api(`entry/${encodeURIComponent(record.id)}`); adopt(server); setRecoveryCopies([]); }
                              catch (error: any) { setError(error.message); }
                            }}
                          >
                            使用服务器版本
                          </button>
                        </div>
                      )}
                      <div className={'editor-grid' + (record.value.kind === 'page' || record.value.blocks.length > 0 ? ' page-editing' : '')}>
                        <div className="writing">
                          <input
                            className="title-input"
                            aria-label="内容标题"
                            value={record.value.title}
                            placeholder="标题"
                            onChange={(e) => update({ title: e.target.value })}
                          />
                          <textarea
                            className="description-input"
                            aria-label="内容摘要"
                            rows={2}
                            placeholder="用一两句话介绍这份内容…"
                            value={record.value.description}
                            onChange={(e) => update({ description: e.target.value })}
                          />
                          {record.value.kind === 'page' || record.value.blocks.length > 0 ? (
                            <Suspense fallback={<p>正在载入页面编辑…</p>}><PageDesigner
                              entryId={record.id}
                              previewKey={JSON.stringify([record.value.template, record.value.title, record.value.description, record.value.fields])}
                              value={record.value.blocks}
                              onChange={(blocks) => update({ blocks, ...(!blocks.length ? { document: { version: 1, format: 'markdown', source: '' } as const } : {}) })}
                              save={persist} onError={setError} catalog={{ ...state, allowedBlocks: record.value.kind==='content'?state.types.find((row:any)=>row.id===record.value.type)?.value.allowedBlocks:undefined }}
                              saveSnippet={record.value.kind==='content'?async(blocks)=>{ const label=window.prompt('组合名称');if(!label?.trim())return;await api('layouts',{value:{id:'snippet-'+crypto.randomUUID(),label,kind:'pattern',appliesTo:'content',blocks},revision:null});await refresh();notify('所选片段已保存为组合'); }:undefined}
                            /></Suspense>
                          ) : (
                            <Suspense fallback={<p>正在载入编辑器…</p>}>
                              <Editor
                                key={record.id + ':' + editorEpoch}
                                value={record.value.document}
                                onChange={(document) => update({ document })}
                                onMedia={() => selectors.media()}
                                onError={setError}
                              />
                            </Suspense>
                          )}
                          {record.value.kind === 'content' && (
                              <Fields
                                key={record.id}
                                definitions={
                                  state.types.find((t: any) => t.id === record.value.type)?.value
                                    .fields ?? []
                                }
                                layout={state.types.find((t: any) => t.id === record.value.type)?.value.admin?.fields}
                                errors={contentCheck?.id === record.id ? contentCheck.errors : []}
                                values={record.value.fields}
                                onChange={(fields) => update({ fields })}
                              />
                          )}
                        </div>
                        <aside className="entry-settings">
                          <h2>发布设置</h2>
                          <label className="checkbox"><input type="checkbox" checked={record.value.allowComments !== false} onChange={(event) => update({ allowComments: event.target.checked })} />允许新评论</label>
                          <SaveCreationTemplate entry={record.value} onSaved={async () => { await refresh(); }} onError={setError} />
                          {record.value.kind === 'content' && !record.value.blocks.length && (!state.types.find((row:any)=>row.id===record.value.type)?.value.allowedBlocks || state.types.find((row:any)=>row.id===record.value.type).value.allowedBlocks.includes('richtext')) && <button onClick={async () => { try { update({ blocks: await api('entry/structure', { value: current.current!.value }) }); } catch (error: any) { setError(error.message); } }}>使用区块正文</button>}
                          {record.value.blocks.length > 0 && <button onClick={async () => { const label = window.prompt('组合名称'); if (!label?.trim()) return; try { await api('layouts', { value: { id: 'snippet-' + crypto.randomUUID(), label, kind: 'pattern', appliesTo: 'any', blocks: record.value.blocks }, revision: null }); await refresh(); notify('正文片段已保存为组合'); } catch (error: any) { setError(error.message); } }}>保存正文片段</button>}
                          <EditorialFields value={record.value} onChange={update} entries={state.entries ?? []} />
                          {record.value.compatibility?.wordpress?.unresolved?.length > 0 && <section className="import-review"><h3>来源功能检查</h3><ul>{record.value.compatibility!.wordpress.unresolved.map((reason: string) => <li key={reason}>{reason}</li>)}</ul><label className="checkbox"><input type="checkbox" checked={!!record.value.compatibility!.wordpress.reviewed} onChange={(event) => update({ compatibility: { ...record.value.compatibility, wordpress: { ...record.value.compatibility!.wordpress, reviewed: event.target.checked } } })} />我已检查并处理这些内容</label></section>}
                          <label>页面模板<select value={record.value.template ?? ''} onChange={(event) => update({ template: event.target.value || undefined })}><option value="">使用默认模板</option>{(state.layouts ?? []).filter((row: any) => row.value.kind === 'template' && ['any', record.value.kind].includes(row.value.appliesTo)).map((row: any) => <option key={row.id} value={row.id}>{row.value.label}</option>)}</select></label>
                          <label>定时发布<input type="datetime-local" aria-label="定时发布时间" value={scheduleDueAt} onChange={(event) => setScheduleDueAt(event.target.value)} /></label>
                          <button disabled={!scheduleDueAt || busy} onClick={async () => {
                            try { const row = await persist();
                              await api('schedule', { id: row.id, revision: row.revision, dueAt: new Date(scheduleDueAt).toISOString() });
                              setScheduleDueAt(''); await refresh(); notify('定时发布已安排');
                            } catch (error: any) { setError(error.message); }
                          }}>安排发布</button>
                          {(state.schedules ?? []).filter((item: any) => item.value.entryId === record.id && ['scheduled', 'failed'].includes(item.value.status)).map((item: any) => <div className="schedule-item" key={item.id}>
                            <time>{new Date(item.value.dueAt).toLocaleString()}</time><p>{item.value.status === 'failed' ? item.value.error : '等待发布指定修订'}</p>
                            <button onClick={async () => { try { await api('schedule/cancel', { id: item.id, revision: item.revision }); await refresh(); } catch (error: any) { setError(error.message); } }}>取消计划</button>
                            {item.value.status === 'failed' && <button onClick={async () => { try { await api('schedule/retry', { id: item.id, revision: item.revision }); await refresh(); } catch (error: any) { setError(error.message); } }}>重试</button>}
                          </div>)}
                          <label>
                            可见性
                            <select aria-label="文章可见性" value={record.value.visibility ?? 'public'} onChange={(e) => update({ visibility: e.target.value as Entry['visibility'] })}>
                              <option value="public">公开</option>
                              <option value="private">私密（仅站主）</option>
                            </select>
                          </label>
                          <label>
                            网址
                            <input
                              value={record.value.path}
                              onChange={(e) => update({ path: e.target.value })}
                            />
                          </label>
                          {record.value.kind === 'content' && (
                            <>
                              <label>
                                内容类型
                                <select
                                  value={record.value.type}
                                  onChange={(e) => update({ type: e.target.value })}
                                >
                                  {state.types.map((t: any) => (
                                    <option key={t.id} value={t.id}>
                                      {t.value.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                作者
                                <input
                                  value={record.value.author}
                                  onChange={(e) => update({ author: e.target.value })}
                                />
                              </label>
                              <TermPicker label="分类" kind="category" terms={(state.terms ?? []).map((row: any) => row.value)} value={record.value.categories} selectedIds={record.value.termIds?.categories} onChange={(categories, ids) => update({ categories, termIds: { categories: ids, tags: record.value.termIds?.tags ?? [] } })} />
                              <TermPicker label="标签" kind="tag" terms={(state.terms ?? []).map((row: any) => row.value)} value={record.value.tags} selectedIds={record.value.termIds?.tags} onChange={(tags, ids) => update({ tags, termIds: { tags: ids, categories: record.value.termIds?.categories ?? [] } })} />

                            </>
                          )}
                          {contentCheck?.id === record.id && <div className="content-check" role="status">{contentCheck.valid ? '检查通过，尚未发布。' : <ul>{contentCheck.errors.map((error: any, index: number) => <li key={index} data-error-path={error.path}><button type="button" onClick={() => { const field = document.querySelector('[data-field-path="' + CSS.escape(error.path) + '"]'); field?.scrollIntoView({ block: 'center' }); (field?.querySelector('input,select,textarea,button') as HTMLElement)?.focus(); }}>{error.message}</button></li>)}</ul>}</div>}
                          <label>
                            封面
                            {record.value.cover && (
                              <img
                                className="cover-preview"
                                src={record.value.cover}
                                alt="内容封面"
                              />
                            )}
                            <input
                              value={record.value.cover}
                              placeholder="图片地址"
                              onChange={(e) => update({ cover: e.target.value })}
                            />
                          </label>
                          <button
                            onClick={async () => {
                              const media = await selectors.media('image');
                              if (media) update({ cover: media.url });
                            }}
                          >
                            <Upload size={14} />
                            选择封面
                          </button>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={record.value.visibility !== 'private' && record.value.indexable}
                              disabled={record.value.visibility === 'private'}
                              onChange={(e) => update({ indexable: e.target.checked })}
                            />
                            允许搜索引擎收录
                          </label>
                          <SeoFields value={record.value} onChange={update} canVerify={!dirty && !saving} />
                          <div className="settings-divider" />
                          <button
                            onClick={() => {
                              const blob = new Blob(
                                [
                                  record.value.document.format === 'markdown'
                                    ? record.value.document.source
                                    : JSON.stringify(record.value, null, 2),
                                ],
                                { type: 'text/plain' },
                              );
                              const url = URL.createObjectURL(blob),
                                a = document.createElement('a');
                              a.href = url;
                              a.download =
                                record.id +
                                (record.value.document.format === 'markdown' ? '.md' : '.json');
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            导出内容
                          </button>
                          <button
                            onClick={async () => {
                              const row = await persist();
                              await api('withdraw', { id: row.id, revision: row.revision });
                              await refresh();
                              await select(row.id);
                            }}
                          >
                            撤下为草稿
                          </button>
                          <button
                            onClick={async () => {
                              const row = await persist();
                              await api('withdraw', {
                                id: row.id,
                                revision: row.revision,
                                archive: true,
                              });
                              await refresh();
                              await select(row.id);
                            }}
                          >
                            <Archive size={14} />
                            归档
                          </button>
                        </aside>
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
            {tab === 'layouts' && <Suspense fallback={<p>正在载入布局…</p>}><LayoutManager catalog={state} refresh={refresh} publish={() => task('publish', { scope: 'layouts' })} onError={setError} registerSave={(save) => { childSave.current = save; }} /></Suspense>}
            {tab === 'terms' && <Suspense fallback={<p>正在载入分类…</p>}><TaxonomyManager rows={state.terms ?? []} refresh={refresh} publish={() => task('publish', { scope: 'terms' })} onError={setError} registerSave={(save) => { childSave.current = save; }} /></Suspense>}
            {tab === 'types' && (
              <TypeManager
                types={state.types}
                extensionBlocks={state.extensionBlocks??[]}
                templates={state.layouts ?? []}
                onSave={async (value, revision) => {
                  await api('types', { value, revision });
                  await refresh();
                  notify('内容类型已保存');
                }}
                onError={setError}
              />
            )}
            {tab === 'media' && <Suspense fallback={<p>正在载入媒体…</p>}><MediaManager onError={setError} onOpen={(id) => { api(`entry/${encodeURIComponent(id)}`).then((row) => { setTab(row.value.kind === 'page' ? 'pages' : 'content'); void select(id); }).catch((error) => setError(error.message)); }} /></Suspense>}
            {tab === 'appearance' && (
              <SettingsPanel
                row={state.settings}
                themes={state.themes ?? []}
                panels={state.extensionPanels ?? []}
                layouts={state.layouts ?? []}
                publish={() => task('publish', { scope: 'settings' })}
                save={async (value, revision) => {
                  await api('settings', { value, revision });
                  await refresh();
                  notify('设置工作稿已保存');
                }}
                onError={setError}
              />
            )}
            {tab === 'analytics' && <AnalyticsPanel onError={setError} />}
            {tab === 'search-tools' && <Suspense fallback={<p>正在载入检查…</p>}><SearchTools /></Suspense>}
            {tab === 'comments' && <Suspense fallback={<p>加载中…</p>}><Comments onError={setError} /></Suspense>}
            {tab === 'redirects' && <Suspense fallback={<p>加载中…</p>}><RedirectManager onError={setError} publish={() => task('publish', { scope: 'routes' })} /></Suspense>}
            {tab === 'publication-plans' && <Suspense fallback={<p>加载中…</p>}><PublicationPlans onError={setError} /></Suspense>}
            {tab === 'operations' && (
              <Operations state={state} task={task} refresh={async () => { await refresh(); }} onError={setError} />
            )}
          </>
        )}
      </main>
      {sessionExpired && !reauth && <div className="recovery-banner" role="status">登录已过期，编辑内容仍保留。<button type="button" onClick={() => setReauth(true)}>重新登录</button></div>}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {publication && (
        <Dialog label="发布变更" onClose={() => setPublication(null)} dismissible={!busy}>
          <div className="modal-title"><h2>发布变更</h2><button disabled={busy} onClick={() => setPublication(null)}>关闭</button></div>
          {error && <p className="error" role="alert">{error}</p>}
          {publication.settingsChanged && <p>网站设置</p>}
          {publication.layoutsChanged && <p>页面模板与共享区域</p>}
          {publication.routesChanged && <p>网址别名</p>}
          {publication.termsChanged && <p>分类与标签</p>}
          {publication.entries.map((entry: any) => <p key={entry.id}>{entry.action === 'add' ? '新增' : '更新'} · {entry.title}<small>{entry.path}</small></p>)}
          {publication.removed.map((entry: any) => <p key={entry.id}>撤下 · {entry.title}</p>)}
          {!publication.settingsChanged && !publication.layoutsChanged && !publication.routesChanged && !publication.termsChanged && !publication.entries.length && !publication.removed.length && <p>没有需要发布的修改。</p>}
          <button className="primary" disabled={busy || (!publication.settingsChanged && !publication.layoutsChanged && !publication.routesChanged && !publication.termsChanged && !publication.entries.length && !publication.removed.length)} onClick={async () => {
            const result = await task('publish', publication.options, true);
            if (result) { setPublication(null); if (current.current) await select(current.current.id); }
          }}>{busy ? '正在发布…' : '确认发布'}</button>
        </Dialog>
      )}
      {reauth && <Dialog label="重新登录" onClose={() => { reauthLater.current = true; setReauth(false); }} dismissible={!loginPending}><h2>登录已过期</h2><p>编辑内容仍保留在当前页面。</p><form onSubmit={async (event) => { event.preventDefault(); if (loginPending) return; setLoginPending(true); setReauthError(''); try { await api('login', { password: reauthPassword }); setReauth(false); setSessionExpired(false); reauthLater.current = false; setReauthPassword(''); setError(''); errorRef.current = ''; setPublication(null); if (dirty && current.current) await persist(); } catch (error: any) { setReauthError(error.message); } finally { setLoginPending(false); } }}><label>站主密码<input data-autofocus type="password" autoComplete="current-password" required value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></label>{reauthError && <p role="alert" className="error">{reauthError}</p>}<button type="submit" disabled={loginPending}>{dirty && record ? '登录并保存草稿' : '重新登录'}</button><button type="button" disabled={loginPending} onClick={() => { reauthLater.current = true; setReauth(false); }}>稍后登录</button></form></Dialog>}
      {bulkOpen && <Suspense fallback={null}><BulkEditor rows={items.filter((row: any) => bulkIds.includes(row.id))} types={state.types} terms={state.terms ?? []} close={() => setBulkOpen(false)} done={async () => { await refresh(); if (record && bulkIds.includes(record.id)) adopt(await api(`entry/${record.id}`)); setBulkIds([]); }} /></Suspense>}
      {creating && <ChooseCreationTemplate templates={state.creationTemplates ?? []} kind={creating.kind} type={creating.type} create={(templateId) => createNew(creating.kind, creating.type, templateId)} close={() => setCreating(null)} refresh={async () => { await refresh(); }} onError={setError} />}
      {history && record && <Suspense fallback={null}><RevisionDialog id={record.id} history={history} onClose={() => setHistory(null)} onError={setError} onRestore={async (version) => {
        const row = await api('restore', { id: record.id, version, revision: record.revision });
        adopt(row); setHistory(null); await refresh(); notify('历史版本已恢复为工作稿，公开页面保持原版本。');
      }} /></Suspense>}
      {conflict && <Suspense fallback={null}><MergeDialog plan={conflict} onClose={() => setConflict(null)} onError={setError} onRemote={() => adopt(conflict.remote)} onSave={async (choices) => {
        try { const row = await api('entry/merge/save', { id: conflict.id, baseRevision: conflict.base.revision, currentRevision: conflict.remote.revision, value: conflict.local, choices });
          adopt(row); await refresh(); notify('已保存合并结果。');
        } catch (error: any) { if (error.status === 409 && current.current) await showConflict(current.current); throw error; }
      }} /></Suspense>}
      {preview && (
        <Dialog className="preview-modal" label="实际页面预览" onClose={() => setPreview('')}>
            <div className="modal-title">
              <h2>实际页面预览</h2>
              <button aria-pressed={narrow} onClick={() => setNarrow(!narrow)}>{narrow ? '桌面宽度' : '窄屏宽度'}</button>
              <button onClick={() => setPreview('')}>关闭</button>
            </div>
            <iframe
              title="实际页面预览"
              src={preview}
              sandbox="allow-same-origin"
              style={{ width: narrow ? 390 : '100%' }}
            />
        </Dialog>
      )}
    </div></FieldWidgetsProvider>
  );
}
function TypeManager({
  types,
  extensionBlocks,
  templates,
  onSave,
  onError,
}: {
  types: any[];
  extensionBlocks:string[];
  templates: any[];
  onSave: (value: ContentType, revision: number | null) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [selected, setSelected] = useState<any>(types[0] ?? null);
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>内容类型</h1>
          <p>定义文章、作品或属于你自己的内容。</p>
        </div>
        <button
          className="primary"
          onClick={() =>
            setSelected({
              revision: null,
              value: {
                id: 'custom-' + Date.now().toString(36),
                label: '新内容类型',
                pathPrefix: '/items/',
                template: 'article',
                fields: [],
              },
            })
          }
        >
          <Plus size={16} />
          新建类型
        </button>
      </div>
      <div className="split-panel">
        <nav className="object-list">
          {types.map((t) => (
            <button key={t.id} onClick={() => setSelected(t)}>
              {t.value.label}
              <small>{t.id}</small>
            </button>
          ))}
        </nav>
        {selected && (
          <div className="form-card">
            <label>
              名称
              <input
                value={selected.value.label}
                onChange={(e) =>
                  setSelected({ ...selected, value: { ...selected.value, label: e.target.value } })
                }
              />
            </label>
            <label>
              标识
              <input
                disabled={!!selected.revision}
                value={selected.value.id}
                onChange={(e) =>
                  setSelected({ ...selected, value: { ...selected.value, id: e.target.value } })
                }
              />
            </label>
            <label>
              默认网址前缀
              <input
                value={selected.value.pathPrefix}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    value: { ...selected.value, pathPrefix: e.target.value },
                  })
                }
              />
            </label>
            <FieldDefinitions
              value={selected.value.fields}
              types={types.map((row) => row.value)}
              onChange={(fields) =>
                setSelected({ ...selected, value: { ...selected.value, fields } })
              }
            />
            <details><summary>正文区块</summary><label className="checkbox"><input type="checkbox" checked={selected.value.allowedBlocks!==undefined} onChange={(event)=>setSelected({...selected,value:{...selected.value,allowedBlocks:event.target.checked?Object.keys(blockDefinitions).filter((key)=>!key.startsWith('entry-')&&key!=='compatibility'):undefined}})} />限制可用区块</label>{selected.value.allowedBlocks!==undefined&&<fieldset><legend>允许的正文区块</legend>{[...Object.entries(blockDefinitions).filter(([key])=>!key.startsWith('entry-')&&key!=='compatibility').map(([key,value])=>({key,label:value.label})),...extensionBlocks.map((key:string)=>({key,label:key}))].map(({key,label})=><label className="checkbox" key={key}><input type="checkbox" aria-label={'允许区块 '+label} checked={selected.value.allowedBlocks.includes(key)} onChange={(event)=>setSelected({...selected,value:{...selected.value,allowedBlocks:event.target.checked?[...selected.value.allowedBlocks,key]:selected.value.allowedBlocks.filter((value:string)=>value!==key)}})} />{label}</label>)}</fieldset>}</details>
            <TypeAdminLayout type={selected.value} onChange={(admin) => setSelected({ ...selected, value: { ...selected.value, admin } })} />
            <label>默认模板<select value={selected.value.template} onChange={(event) => setSelected({ ...selected, value: { ...selected.value, template: event.target.value } })}>{templates.filter((row) => row.value.kind === 'template' && row.value.appliesTo !== 'page').map((row) => <option key={row.id} value={row.id}>{row.value.label}</option>)}</select></label>
            <label>页面语义<select value={selected.value.schemaType ?? ''} onChange={(event) => setSelected({ ...selected, value: { ...selected.value, schemaType: event.target.value || undefined } })}><option value="">自动</option>{schemaTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            <button
              className="primary"
              onClick={() =>
                onSave(selected.value, selected.revision)
                  .then(() => setSelected(null))
                  .catch((e) => onError(e.message))
              }
            >
              保存类型
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function SettingsPanel({
  row,
  themes,
  panels,
  layouts,
  save,
  publish,
  onError,
}: {
  row: any;
  themes: any[];
  panels: any[];
  layouts: any[];
  save: (v: Settings, r: number) => Promise<void>;
  publish: () => any;
  onError: (s: string) => void;
}) {
  const [value, setValue] = useState<Settings>(row.value),
    [revision, setRevision] = useState(row.revision);
  useEffect(() => {
    setRevision(row.revision);
  }, [row.revision]);
  const set = (p: Partial<Settings>) => setValue((v) => ({ ...v, ...p }));
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>外观与导航</h1>
          <p>保存为工作稿，发布后更新网站。</p>
        </div>
        <div>
          <button onClick={() => save(value, revision).catch((e) => onError(e.message))}>
            保存设置
          </button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await save(value, revision);
                await publish();
              } catch (e: any) {
                onError(e.message);
              }
            }}
          >
            发布设置
          </button>
        </div>
      </div>
      <div className="settings-panels">
        <SiteSeoFields value={value} onChange={set} />
        <section className="form-card">
          <h2>网站</h2>
          {[
            ['name', '名称'],
            ['description', '介绍'],
            ['domain', '正式网址'],
            ['logo', 'Logo 地址'],
            ['language', '语言'],
            ['timezone', '时区'],
            ['footer', '页脚文字'],
            ['sourceUrl', '项目源代码地址'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={(value as any)[key] ?? ''}
                onChange={(e) => set({ [key]: e.target.value })}
              />
            </label>
          ))}
        </section>
        <section className="form-card">
          <h2>主题</h2>
          {(['header', 'before', 'after', 'footer'] as const).map((position) => <label key={position}>{({ header: '页头', before: '正文上方', after: '正文下方', footer: '页脚' })[position]}<select value={value.regions?.[position] ?? ''} onChange={(event) => set({ regions: { ...value.regions, [position]: event.target.value || undefined } })}><option value="">使用默认</option>{layouts.filter((row) => row.value.kind === 'region').map((row) => <option key={row.id} value={row.id}>{row.value.label}</option>)}</select></label>)}
          <label>
            主题
            <select aria-label="主题" value={value.theme} onChange={(e) => set({ theme: e.target.value, themeSettings: { ...value.themeSettings, [value.theme]: value.themeConfig }, themeConfig: value.themeSettings?.[e.target.value] ?? defaultSettings.themeConfig })}>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {[
            ['accent', '强调色', 'color'],
            ['background', '背景色', 'color'],
            ['width', '页面宽度', 'number'],
            ['radius', '圆角', 'number'],
            ['spacing', '区块间距', 'number'],
            ['font', '字体', 'text'],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                type={type}
                value={(value.themeConfig as any)[key]}
                onChange={(e) =>
                  set({
                    themeConfig: {
                      ...value.themeConfig,
                      [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
        </section>
        {value.theme === 'newsletter' && <section className="form-card">
          <h2>文章目录</h2>
          <label className="checkbox">
            <input type="checkbox" checked={value.extensions.newsletter?.tocDefaultOpen === true}
              onChange={(e) => set({ extensions: { ...value.extensions, newsletter: { ...value.extensions.newsletter, tocDefaultOpen: e.target.checked } } })} />
            默认展开侧边目录
          </label>
        </section>}
        <section className="form-card">
          <label className="checkbox"><input type="checkbox" checked={value.commentModeration !== false} onChange={(event) => set({ commentModeration: event.target.checked })} />新评论需要审核</label>
          <h2>导航</h2>
          <NavigationEditor value={value.navigation} onChange={(navigation) => set({ navigation })} />
        </section>
        <section className="form-card">
          <h2>分类目录</h2>
          {value.taxonomies.map((t, i) => (
            <div className="navigation-row" key={i}>
              <input
                aria-label="分类标识"
                value={t.id}
                onChange={(e) =>
                  set({
                    taxonomies: value.taxonomies.map((v, j) =>
                      i === j ? { ...v, id: e.target.value } : v,
                    ),
                  })
                }
              />
              <input
                aria-label="分类名称"
                value={t.label}
                onChange={(e) =>
                  set({
                    taxonomies: value.taxonomies.map((v, j) =>
                      i === j ? { ...v, label: e.target.value } : v,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            onClick={() =>
              set({
                taxonomies: [
                  ...value.taxonomies,
                  { id: 'topic-' + (value.taxonomies.length + 1), label: '新分类' },
                ],
              })
            }
          >
            添加分类
          </button>
        </section>
        {panels.filter((panel) => !panel.themes?.length || panel.themes.includes(value.theme)).map((panel) => (
          <section className="form-card" key={panel.id}>
            <h2>{panel.label}</h2>
            <Fields
              definitions={panel.fields}
              values={value.extensions[panel.id] ?? {}}
              onChange={(v) => set({ extensions: { ...value.extensions, [panel.id]: v } })}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
function TableView({ rows }: { rows: any[] }) {
  return (
    <div className="table-scroll">
      {!rows.length ? (
        <p className="muted">暂无记录</p>
      ) : (
        <table>
          <thead>
            <tr>
              {Object.keys(rows[0]).map((k) => (
                <th key={k}>
                  {(
                    {
                      path: '页面',
                      views: '浏览',
                      clicks: '点击',
                      historicalViews: '历史浏览',
                      recordedViews: '新增浏览',
                      url: '链接',
                      zone: '位置',
                      label: '文字',
                    } as any
                  )[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i}>
                {Object.values(r).map((v, j) => (
                  <td key={j}>{String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function Operations({
  state,
  task,
  refresh,
  onError,
}: {
  state: any;
  task: (op: 'publish' | 'backup' | 'verify', p?: any) => any;
  refresh: () => any;
  onError: (s: string) => void;
}) {
  const [path, setPath] = useState('D:/Tools/weava/backups'),
    [verify, setVerify] = useState(''),
    [logs, setLogs] = useState<any>(null),
    [usage, setUsage] = useState<any>(null);
  const size = (n: number) => (n / 1048576).toFixed(1) + ' MB';
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>运行与备份</h1>
          <p>发布记录、任务状态与内容备份。</p>
          {state.program && <p>程序 {state.program.framework} · 数据版本 {state.program.databaseSchema}{state.program.selected ? ' · 使用已检查的独立版本' : ''}</p>}
        </div>
        <button onClick={refresh}>刷新</button>
      </div>
      <div className="settings-panels">
        <section className="form-card">
          <h2>全站发布</h2>
          <p>发布已有公开内容、页面及设置的工作稿；新草稿可在编辑页单独发布。</p>
          <button className="primary" onClick={() => task('publish', {})}>
            发布全站工作稿
          </button>
        </section>
        <section className="form-card">
          <h2>完整备份</h2>
          <label>
            备份根目录
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <button onClick={() => task('backup', { path })}>创建备份</button>
          <label>
            校验备份目录
            <input value={verify} onChange={(e) => setVerify(e.target.value)} />
          </label>
          <button onClick={() => task('verify', { path: verify })}>校验</button>
        </section>
      </div>
      <Suspense fallback={<p>正在载入导入工具…</p>}><ImportManager refresh={refresh} /></Suspense>
      <Suspense fallback={<p>正在载入扩展…</p>}><ExtensionManager rows={state.extensions ?? []} refresh={refresh} /></Suspense>
      <Suspense fallback={<p>正在载入历史维护…</p>}><HistoryMaintenance refresh={refresh} /></Suspense>
      <section className="form-card">
        <h2>空间占用</h2>
        <button
          onClick={() =>
            api('maintenance')
              .then(setUsage)
              .catch((e) => onError(e.message))
          }
        >
          检查占用
        </button>
        {usage && (
          <>
            <p>
              内容数据库 {size(usage.databaseBytes)} · 统计 {size(usage.analyticsBytes)} · 媒体{' '}
              {size(usage.media.bytes)}
            </p>
            <p>
              {usage.versions.count} 个历史版本 · {usage.releases.count} 个发布版本 ·{' '}
              {usage.backups.length} 份已记录备份
            </p>
            <p>
              未被内容或历史引用的媒体：{usage.unreferenced.count} 个，
              {size(usage.unreferenced.bytes)}。文件继续保留。
            </p>
            {usage.backups.map((b: any) => (
              <p key={b.path}>
                {b.path} · {size(b.bytes)}
              </p>
            ))}
          </>
        )}
      </section>
      <h2>公开版本</h2>
      <div className="release-list">
        {state.releases.slice(0, 20).map((r: any) => (
          <div key={r.id}>
            <span>
              {new Date(r.created_at).toLocaleString()}
              <small>{r.id}</small>
            </span>
            <button
              onClick={async () => {
                try {
                  await api('rollback', { id: r.id });
                  await refresh();
                } catch (e: any) {
                  onError(e.message);
                }
              }}
            >
              切换到这个版本
            </button>
          </div>
        ))}
      </div>
      <h2>任务记录</h2>
      <div className="release-list">
        {state.jobs.map((j: any) => (
          <div key={j.id}>
            <span>
              {j.operation} · {j.status}
              <small>{j.message}</small>
            </span>
            <button onClick={async () => setLogs(await api(`logs?id=${j.id}`))}>日志</button>
          </div>
        ))}
      </div>
      {logs && (
        <section className="form-card">
          <h3>任务日志</h3>
          <pre>{logs.text || '暂无日志'}</pre>
          <small>
            {logs.start}—{logs.end} / {logs.total}
          </small>
        </section>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<SelectorsProvider><App /></SelectorsProvider>);
