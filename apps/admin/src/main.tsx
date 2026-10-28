import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FileText,
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
  defaultSettings,
  type Entry,
  type FieldDefinition,
  type ContentType,
  type Settings,
  type Revision,
} from '@weava/contracts';
import { api, waitJob } from './api.ts';
import { Blocks } from './Blocks.tsx';
import './style.css';
const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));
const Comments = lazy(() => import('./Comments.tsx'));
const tabs = [
  ['content', '内容', FileText],
  ['pages', '页面', PanelsTopLeft],
  ['types', '内容类型', Shapes],
  ['media', '媒体', Images],
  ['comments', '评论', MessageSquare],
  ['appearance', '外观与导航', Palette],
  ['analytics', '访问统计', ChartNoAxesCombined],
  ['operations', '运行与备份', Settings2],
] as const;
function App() {
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
  const [editorEpoch, setEditorEpoch] = useState(0);
  const current = useRef(record),
    saved = useRef(''),
    running = useRef<Promise<any> | null>(null),
    errorRef = useRef('');
  current.current = record;
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  };
  async function refresh() {
    const data = await api('state');
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
  async function persist(): Promise<any> {
    if (running.current) {
      await running.current;
      return persist();
    }
    const row = current.current;
    if (!row || JSON.stringify(row.value) === saved.current) return row;
    const snapshot = structuredClone(row);
    setSaving(true);
    const task = api('entry', { value: snapshot.value, revision: snapshot.revision || null })
      .then((result) => {
        saved.current = JSON.stringify(snapshot.value);
        if (current.current?.id === snapshot.id) {
          const unchanged =
            JSON.stringify(current.current.value) === JSON.stringify(snapshot.value);
          const next = { ...result, value: unchanged ? result.value : current.current.value };
          if (unchanged) saved.current = JSON.stringify(result.value);
          current.current = next;
          setRecord(next);
          setDirty(!unchanged);
          if (unchanged) localStorage.removeItem('weava-draft:' + snapshot.id);
        }
        return result;
      })
      .catch((e) => {
        setError(e.message);
        errorRef.current = e.message;
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
      localStorage.setItem('weava-draft:' + record.id, JSON.stringify(record));
    } catch {}
    const timer = setTimeout(() => persist().catch(() => {}), 1200);
    return () => clearTimeout(timer);
  }, [record, dirty]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
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
    setRecord((old) => (old ? { ...old, value: { ...old.value, ...patch } } : old));
    setDirty(true);
  }
  async function select(id: string) {
    try {
      await persist();
      const row = await api('entry/' + encodeURIComponent(id));
      setRecord(row);
      setEditorEpoch((v) => v + 1);
      current.current = row;
      saved.current = JSON.stringify(row.value);
      setDirty(false);
      setPreview('');
      setHistory(null);
      const local = localStorage.getItem('weava-draft:' + id);
      setRestoreLocal(
        local &&
          JSON.parse(local).value &&
          JSON.stringify(JSON.parse(local).value) !== JSON.stringify(row.value)
          ? JSON.parse(local)
          : null,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function navigate(next: string) {
    try {
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
  async function newEntry() {
    try {
      await persist();
      const kind = tab === 'pages' ? 'page' : 'content',
        type = state.types[0]?.value.id ?? 'post',
        id = crypto.randomUUID();
      const value = entrySchema.parse({
        id,
        kind,
        type,
        title: '未命名' + (kind === 'page' ? '页面' : '内容'),
        path:
          (kind === 'page'
            ? '/'
            : (state.types.find((t: any) => t.id === type)?.value.pathPrefix ?? '/posts/')) +
          id.slice(0, 8) +
          '/',
        document: {
          version: 1,
          format: 'lexical',
          source: {
            root: {
              children: [
                {
                  type: 'paragraph',
                  version: 1,
                  children: [],
                  direction: null,
                  format: '',
                  indent: 0,
                  textFormat: 0,
                  textStyle: '',
                },
              ],
              direction: null,
              format: '',
              indent: 0,
              type: 'root',
              version: 1,
            },
          },
        },
      });
      const row = await api('entry', { value, revision: null });
      await refresh();
      setRecord(row);
      current.current = row;
      saved.current = JSON.stringify(row.value);
      setDirty(false);
      setPreview('');
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function task(operation: string, payload: any = {}) {
    setBusy(true);
    setError('');
    try {
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
  if (!session) return <div className="loading-screen">Weava</div>;
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
            try {
              await api('login', { password });
              setSession(await api('session'));
              setError('');
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <label>
            站主密码
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={!session.initialized}>
            进入网站
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <a href="/">查看网站 ↗</a>
      </main>
    );
  const items = (state?.entries ?? []).filter(
    (r: any) =>
      r.value.kind === (tab === 'pages' ? 'page' : 'content') &&
      (r.value.title + r.value.description).toLowerCase().includes(filter.toLowerCase()) &&
      (visibility === 'all' || (r.value.visibility ?? 'public') === visibility) &&
      (status === 'all' ||
        (status === 'published'
          ? r.published
          : status === 'changed'
            ? r.published && r.hasChanges
            : r.value.status === status && !r.published)),
  );
  return (
    <div className="app">
      <aside className={'sidebar ' + (menu ? 'open' : '')}>
        <a className="app-brand" href="/admin/">
          <span>w</span>Weava
        </a>
        <div className="site-name">{state?.settings.value.name ?? '你的网站'}</div>
        <nav>
          {tabs.map(([key, label, Icon]) => (
            <button className={tab === key ? 'active' : ''} key={key} onClick={() => navigate(key)}>
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
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-label="打开菜单">
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            {state?.settings.value.name}
            <span>/</span>
            {tabs.find((t) => t[0] === tab)?.[1]}
          </div>
          <a href="/" target="_blank" className="view-site">
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
                const logs = await api('logs?id=' + job.id);
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
              <div className="content-workspace">
                <section className="library">
                  <div className="library-header">
                    <div>
                      <h1>{tab === 'pages' ? '页面' : '内容'}</h1>
                      <span>{items.length} 项</span>
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
                  <div className="entry-list">
                    {items.map((r: any) => (
                      <button
                        key={r.id}
                        className={record?.id === r.id ? 'selected' : ''}
                        onClick={() => select(r.id)}
                      >
                        <div>
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
                          <time>
                            {new Date(r.updatedAt).toLocaleDateString('zh-CN', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </time>
                        </div>
                        <h3>{r.value.title}</h3>
                        {r.value.visibility === 'private' && <span>私密</span>}
                        <p>{r.value.description || r.value.path}</p>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="editing-area">
                  {!record ? (
                    <div className="empty-state">
                      <div className="empty-mark">✳</div>
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
                        <span className="save-status">
                          {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{' '}
                          {saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
                        </span>
                        <div>
                          <button
                            title="历史版本"
                            onClick={async () => {
                              await persist();
                              setHistory(await api('history?id=' + record.id));
                            }}
                          >
                            <History size={16} />
                          </button>
                          <button
                            onClick={async () => {
                              const row = await persist();
                              setPreview('/__preview/' + record.id + '?revision=' + row.revision);
                            }}
                          >
                            <Eye size={16} />
                            预览
                          </button>
                          <button className="primary" disabled={busy || saving} onClick={publish}>
                            发布
                          </button>
                        </div>
                      </div>
                      {restoreLocal && (
                        <div className="recovery-banner">
                          浏览器保留了一份未保存内容。
                          <button
                            onClick={() => {
                              update(restoreLocal.value);
                              setEditorEpoch((v) => v + 1);
                              setRestoreLocal(null);
                            }}
                          >
                            恢复到编辑器
                          </button>
                          <button
                            onClick={() => {
                              localStorage.removeItem('weava-draft:' + record.id);
                              setRestoreLocal(null);
                            }}
                          >
                            使用服务器版本
                          </button>
                        </div>
                      )}
                      <div className="editor-grid">
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
                          {record.value.kind === 'page' ? (
                            <Blocks
                              value={record.value.blocks}
                              onChange={(blocks) => update({ blocks })}
                            />
                          ) : (
                            <Suspense fallback={<p>正在载入编辑器…</p>}>
                              <Editor
                                key={record.id + ':' + editorEpoch}
                                value={record.value.document}
                                onChange={(document) => update({ document })}
                                onMedia={upload}
                                onError={setError}
                              />
                            </Suspense>
                          )}
                        </div>
                        <aside className="entry-settings">
                          <h2>发布设置</h2>
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
                              <label>
                                分类
                                <input
                                  value={record.value.categories.join(', ')}
                                  onChange={(e) =>
                                    update({
                                      categories: e.target.value
                                        .split(/[,，]/)
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                标签
                                <input
                                  value={record.value.tags.join(', ')}
                                  onChange={(e) =>
                                    update({
                                      tags: e.target.value
                                        .split(/[,，]/)
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              </label>
                              <Fields
                                definitions={
                                  state.types.find((t: any) => t.id === record.value.type)?.value
                                    .fields ?? []
                                }
                                values={record.value.fields}
                                onChange={(fields) => update({ fields })}
                              />
                            </>
                          )}
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
                              const media = await upload();
                              if (media) update({ cover: media.url });
                            }}
                          >
                            <Upload size={14} />
                            上传封面
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
            {tab === 'types' && (
              <TypeManager
                types={state.types}
                onSave={async (value, revision) => {
                  await api('types', { value, revision });
                  await refresh();
                  notify('内容类型已保存');
                }}
                onError={setError}
              />
            )}
            {tab === 'media' && (
              <div className="panel">
                <div className="panel-title">
                  <div>
                    <h1>媒体</h1>
                    <p>图片与附件，集中在这里。</p>
                  </div>
                  <button className="primary" onClick={upload}>
                    <Upload size={16} />
                    上传媒体
                  </button>
                </div>
                <div className="media-grid">
                  {state.media.map((m: any) => (
                    <article key={m.id}>
                      {/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(m.value.url) ? (
                        <img src={m.value.url} loading="lazy" alt={m.value.name} />
                      ) : (
                        <div className="file-placeholder">
                          <FileText size={32} />
                        </div>
                      )}
                      <strong>{m.value.name}</strong>
                      <small>{(m.value.bytes / 1024).toFixed(1)} KB</small>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(m.value.url);
                          notify('地址已复制');
                        }}
                      >
                        复制地址
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {tab === 'appearance' && (
              <SettingsPanel
                row={state.settings}
                themes={state.themes ?? []}
                panels={state.extensionPanels ?? []}
                publish={() => task('publish', {})}
                save={async (value, revision) => {
                  await api('settings', { value, revision });
                  await refresh();
                  notify('设置工作稿已保存');
                }}
                onError={setError}
              />
            )}
            {tab === 'analytics' && <AnalyticsPanel onError={setError} />}
            {tab === 'comments' && <Suspense fallback={<p>加载中…</p>}><Comments onError={setError} /></Suspense>}
            {tab === 'operations' && (
              <Operations state={state} task={task} refresh={refresh} onError={setError} />
            )}
          </>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {history && record && (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-title">
              <h2>历史版本</h2>
              <button onClick={() => setHistory(null)}>关闭</button>
            </div>
            {history.map((v) => (
              <div className="history-row" key={v.revision}>
                <span>
                  {new Date(v.createdAt).toLocaleString()}
                  <small>{v.label}</small>
                </span>
                <button
                  onClick={async () => {
                    await api('restore', {
                      id: record.id,
                      version: v.revision,
                      revision: record.revision,
                    });
                    setHistory(null);
                    await select(record.id);
                  }}
                >
                  恢复为工作稿
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop">
          <section className="preview-modal">
            <div className="modal-title">
              <h2>实际页面预览</h2>
              <button onClick={() => setNarrow(!narrow)}>{narrow ? '桌面宽度' : '窄屏宽度'}</button>
              <button onClick={() => setPreview('')}>关闭</button>
            </div>
            <iframe
              title="实际页面预览"
              src={preview}
              sandbox="allow-same-origin"
              style={{ width: narrow ? 390 : '100%' }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
function Fields({
  definitions,
  values,
  onChange,
}: {
  definitions: FieldDefinition[];
  values: any;
  onChange: (v: any) => void;
}) {
  return (
    <>
      {definitions.map((d) => {
        const value = values[d.key],
          set = (v: any) => onChange({ ...values, [d.key]: v });
        if (d.multiple)
          return (
            <section key={d.key}>
              <label>{d.label}</label>
              {(value ?? []).map((item: any, i: number) => (
                <div key={i}>
                  <Fields
                    definitions={[{ ...d, multiple: false }]}
                    values={{ [d.key]: item }}
                    onChange={(v) =>
                      set(value.map((x: any, j: number) => (i === j ? v[d.key] : x)))
                    }
                  />
                  <button onClick={() => set(value.filter((_: any, j: number) => i !== j))}>
                    移除这项
                  </button>
                </div>
              ))}
              <button onClick={() => set([...(value ?? []), d.type === 'group' ? {} : ''])}>
                添加{d.label}
              </button>
            </section>
          );
        if (d.type === 'group')
          return (
            <fieldset key={d.key}>
              <legend>{d.label}</legend>
              <Fields definitions={d.fields ?? []} values={value ?? {}} onChange={set} />
            </fieldset>
          );
        return (
          <label key={d.key}>
            {d.label}
            {d.required ? ' *' : ''}
            {d.type === 'boolean' ? (
              <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} />
            ) : d.type === 'select' ? (
              <select value={value ?? ''} onChange={(e) => set(e.target.value)}>
                <option value="">请选择</option>
                {d.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : d.type === 'richtext' ? (
              <textarea value={value ?? ''} onChange={(e) => set(e.target.value)} />
            ) : (
              <input
                type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                value={value ?? ''}
                onChange={(e) => set(d.type === 'number' ? Number(e.target.value) : e.target.value)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
function TypeManager({
  types,
  onSave,
  onError,
}: {
  types: any[];
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
              onChange={(fields) =>
                setSelected({ ...selected, value: { ...selected.value, fields } })
              }
            />
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
function FieldDefinitions({
  value,
  onChange,
}: {
  value: FieldDefinition[];
  onChange: (v: FieldDefinition[]) => void;
}) {
  const update = (i: number, patch: any) =>
    onChange(value.map((f, j) => (i === j ? { ...f, ...patch } : f)));
  return (
    <div className="field-definitions">
      <h3>自定义字段</h3>
      {value.map((f, i) => (
        <section key={i}>
          <div className="form-columns">
            <label>
              字段名称
              <input value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
            </label>
            <label>
              字段标识
              <input value={f.key} onChange={(e) => update(i, { key: e.target.value })} />
            </label>
            <label>
              类型
              <select value={f.type} onChange={(e) => update(i, { type: e.target.value })}>
                {Object.entries({
                  text: '文字',
                  richtext: '富文本',
                  number: '数字',
                  boolean: '开关',
                  date: '日期',
                  select: '选项',
                  media: '媒体',
                  reference: '内容引用',
                  group: '字段组',
                }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {f.type === 'select' && (
            <label>
              选项，以逗号分隔
              <input
                value={f.options?.join(',') ?? ''}
                onChange={(e) =>
                  update(i, { options: e.target.value.split(',').map((s) => s.trim()) })
                }
              />
            </label>
          )}
          <div className="inline-options">
            <label>
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              必填
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!f.multiple}
                onChange={(e) => update(i, { multiple: e.target.checked })}
              />
              可重复
            </label>
            <button onClick={() => onChange(value.filter((_, j) => i !== j))}>移除字段</button>
          </div>
          {f.type === 'group' && (
            <FieldDefinitions value={f.fields ?? []} onChange={(fields) => update(i, { fields })} />
          )}
        </section>
      ))}
      <button
        onClick={() =>
          onChange([...value, { key: 'field' + (value.length + 1), label: '新字段', type: 'text' }])
        }
      >
        <Plus size={14} />
        添加字段
      </button>
    </div>
  );
}
function SettingsPanel({
  row,
  themes,
  panels,
  save,
  publish,
  onError,
}: {
  row: any;
  themes: any[];
  panels: any[];
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
          <label>
            主题
            <select value={value.theme} onChange={(e) => set({ theme: e.target.value })}>
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
          <h2>导航</h2>
          {value.navigation.map((n, i) => (
            <div className="navigation-row" key={i}>
              <label>
                文字
                <input
                  value={n.label}
                  onChange={(e) =>
                    set({
                      navigation: value.navigation.map((v, j) =>
                        i === j ? { ...v, label: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                网址
                <input
                  value={n.url}
                  onChange={(e) =>
                    set({
                      navigation: value.navigation.map((v, j) =>
                        i === j ? { ...v, url: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() => set({ navigation: value.navigation.filter((_, j) => j !== i) })}
              >
                移除
              </button>
              {i > 0 && (
                <button
                  onClick={() => {
                    const rows = [...value.navigation];
                    [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
                    set({ navigation: rows });
                  }}
                >
                  上移
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              set({ navigation: [...value.navigation, { label: '新导航', url: '/' }] })
            }
          >
            添加导航
          </button>
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
        {panels.map((panel) => (
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
function AnalyticsPanel({ onError }: { onError: (s: string) => void }) {
  const [data, setData] = useState<any>(null),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const query = () =>
    new URLSearchParams({ ...(start ? { start } : {}), ...(end ? { end } : {}) }).toString();
  const refresh = () =>
    api('analytics?' + query())
      .then(setData)
      .catch((e) => onError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>访问统计</h1>
          <p>了解内容如何被发现与阅读。</p>
        </div>
        <a className="button" href={'/api/admin/v1/analytics/export?' + query()}>
          导出 CSV
        </a>
      </div>
      <div className="date-range">
        <input
          aria-label="开始日期"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <span>至</span>
        <input
          aria-label="结束日期"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <button onClick={refresh}>查询</button>
      </div>
      {data && (
        <>
          <div className="metrics">
            {[
              ['views', '浏览'],
              ['visitors', '访客'],
              ['sessions', '会话'],
              ['clicks', '链接点击'],
            ].map(([key, label]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>{data[key]}</strong>
              </article>
            ))}
          </div>
          <div className="form-card">
            <h2>每日趋势</h2>
            <div className="bar-chart">
              {data.daily.map((d: any) => (
                <div key={d.date} title={`${d.date}：${d.views} 次浏览`}>
                  <span
                    style={{
                      height: Math.max(
                        3,
                        (120 * d.views) / Math.max(1, ...data.daily.map((v: any) => v.views)),
                      ),
                    }}
                  />
                  <small>{d.date.slice(5)}</small>
                </div>
              ))}
            </div>
          </div>
          <TableView rows={data.pages} />
          {data.historicalViews > 0 && <>
            <h2>累计文章浏览</h2>
            <p>累计 {data.lifetimeViews.toLocaleString()} 次，其中迁移历史浏览 {data.historicalViews.toLocaleString()} 次。历史计数没有每日明细，不计入上方日期区间。</p>
            <TableView rows={data.lifetimePages} />
          </>}
          <h2>链接点击</h2>
          <TableView rows={data.links} />
          {data.legacySources.length > 0 && (
            <p>另保留 {data.legacySources.length} 份迁移前统计档案，存放在站点 imports 目录。</p>
          )}
        </>
      )}
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
  task: (op: string, p?: any) => any;
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
            <button onClick={async () => setLogs(await api('logs?id=' + j.id))}>日志</button>
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
createRoot(document.getElementById('root')!).render(<App />);
