// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../apps/admin/src/App.tsx';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
const mocks = vi.hoisted(() => ({ api: vi.fn(), flush: vi.fn(), select: vi.fn(), clear: vi.fn(), onPublished: undefined as undefined | (() => Promise<void>), selection: { current: 0 }, session: { record: null as any }, publication: {} as any, settings: { state: {}, resumePending: vi.fn() } }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: Object.assign(mocks.api, { request: mocks.api }) }));
vi.mock('../apps/admin/src/EditSessions.tsx', () => ({ useEditSessions: () => ({ flush: mocks.flush }) }));
vi.mock('../apps/admin/src/Fields.tsx', () => ({ FieldWidgetsProvider: ({ children }: any) => children }));
vi.mock('../apps/admin/src/useContentWorkspace.ts', () => ({ useContentWorkspace: () => {
  const [, update] = useState(0);
  return {editor:{record:mocks.session.record,dirty:false},library:{setStatus:vi.fn(),setLibraryPage:vi.fn()},dialogs:{},navigation:{current:()=>mocks.session.record,version:()=>mocks.selection.current,cancelSelection:()=>{++mocks.selection.current;},select:mocks.select,clear:(...args:any[])=>{mocks.clear(...args);update(value=>value+1);}}};
} }));
vi.mock('../apps/admin/src/usePublication.ts', () => ({ usePublication: () => mocks.publication }));
vi.mock('../apps/admin/src/useSettingsApplication.ts', () => ({ useSettingsApplication: () => mocks.settings }));
vi.mock('../apps/admin/src/ContentLibrary.tsx', () => ({ ContentLibrary: () => <p>文章列表</p> }));
vi.mock('../apps/admin/src/NotesLibrary.tsx', () => ({ NotesLibrary: () => <p>笔记列表</p> }));
vi.mock('../apps/admin/src/NoteEditor.tsx', () => ({ NoteEditor: () => null }));
vi.mock('../apps/admin/src/EntryEditor.tsx', () => ({ EntryEditor: () => <p>编辑文章</p> }));
vi.mock('../apps/admin/src/ContentDialogs.tsx', () => ({ ContentDialogs: () => null }));
vi.mock('../apps/admin/src/PublicationDialog.tsx', () => ({ PublicationDialog: ({onPublished}:any) => {mocks.onPublished=onPublished;return null;} }));
vi.mock('../apps/admin/src/Reauthentication.tsx', () => ({ Reauthentication: () => null }));
vi.mock('../apps/admin/src/Comments.tsx', () => ({ default: () => <p>评论列表</p> }));
vi.mock('../apps/admin/src/Trash.tsx', () => ({ default: () => <h1>独立回收站</h1> }));
vi.mock('../apps/admin/src/MediaManager.tsx', () => ({ default: () => <p>媒体列表</p> }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const state = { settings: { value: { name: '站点', logo: '' } }, types: [], fieldWidgets: {} };
beforeEach(() => {
  adminQueries.invalidate(true); mocks.api.mockReset(); mocks.flush.mockReset().mockResolvedValue(undefined);
  mocks.publication = {};
  mocks.session.record = null;
  mocks.clear.mockReset().mockImplementation(()=>{
    mocks.session.record=null;
    const url=new URL(window.location.href);url.searchParams.delete('entry');window.history.replaceState(null,'',url);
  });
  window.history.replaceState(null, '', '/admin/');
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (label: string) => [...host.querySelectorAll('nav button')].find(node => node.textContent === label) as HTMLButtonElement;
const render = async () => { await act(async () => root.render(<App authentication={{ session: { authenticated: true } } as any} error="" setError={vi.fn()} />)); };
it('opens trash as a sidebar page with its own URL and restores it from history',async()=>{
  mocks.api.mockResolvedValue(state);await render();
  await act(async()=>{button('回收站').click();await new Promise(resolve=>setTimeout(resolve,10));});
  expect(location.search).toBe('?panel=trash');expect(button('回收站').getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('h1')?.textContent).toBe('独立回收站');expect(host.querySelector('dialog')).toBeNull();
  await act(async()=>button('文章').click());expect(host.textContent).toContain('文章列表');
  await act(async()=>{window.history.replaceState(null,'','/admin/?panel=trash');window.dispatchEvent(new PopStateEvent('popstate'));await new Promise(resolve=>setTimeout(resolve,10));});
  expect(host.querySelector('h1')?.textContent).toBe('独立回收站');
});
it('switches and updates history before the new state request finishes, while cached sections need no state request', async () => {
  let finish!: (value: any) => void;
  mocks.api.mockImplementation((path: string) => path.includes('panel=comments') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(state));
  await render(); expect(host.textContent).toContain('文章列表');
  await act(async () => { button('评论').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(button('评论').getAttribute('aria-current')).toBe('page'); expect(host.textContent).toContain('评论列表'); expect(location.search).toBe('?panel=comments');
  await act(async () => { button('媒体').click(); await new Promise(resolve => setTimeout(resolve, 10)); }); expect(host.textContent).toContain('媒体列表');
  await act(async () => button('文章').click()); expect(host.textContent).toContain('文章列表');
  expect(mocks.api).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ...state, settings: { value: { name: '旧请求', logo: '' } } }));
  expect(host.textContent).not.toContain('旧请求'); expect(location.search).toBe('');
});
it('does not navigate away when saving edits fails', async () => {
  mocks.api.mockResolvedValue(state); await render(); mocks.flush.mockRejectedValue(new Error('保存失败'));
  await act(async () => button('评论').click()); expect(host.textContent).toContain('文章列表'); expect(location.search).toBe(''); expect(mocks.api).toHaveBeenCalledTimes(1);
});
it('keeps backup progress on its own page and leaves the article list usable', async () => {
  mocks.api.mockResolvedValue(state);
  mocks.publication = { busy: true, job: { id: 'backup-job', operation: 'backup', status: 'running', message: '正在启动任务' } };
  await render();
  expect(host.textContent).toContain('文章列表');expect(host.textContent).not.toContain('正在启动任务');expect(host.querySelector('.job-banner')).toBeNull();
  expect(host.querySelector('.operation-progress')).toBeNull();
  mocks.publication = { busy: false, job: null };await render();expect(host.querySelector('.operation-progress')).toBeNull();
});
it('handles same-panel entry history and removes an old entry when switching panels',async()=>{
  mocks.api.mockResolvedValue(state);mocks.select.mockReset().mockImplementation(async(id:string)=>{(mocks.session as {record:any}).record={id};});
  await render();
  await act(async()=>{window.history.replaceState(null,'','/admin/?entry=from-history');window.dispatchEvent(new PopStateEvent('popstate'));});
  expect(mocks.select).toHaveBeenCalledWith('from-history',false);
  expect(new URLSearchParams(location.search).get('entry')).toBe('from-history');
  await act(async()=>button('评论').click());expect(location.search).toBe('?panel=comments');
  (mocks.session as {record:any}).record=null;
});
it('returns to the content list after publication and shows success after the view changes',async()=>{
  mocks.api.mockResolvedValue(state);mocks.session.record={id:'one',value:{kind:'content'}};
  window.history.replaceState(null,'','/admin/?entry=one');await render();
  expect(host.textContent).toContain('编辑文章');
  let finish!:()=>void;
  mocks.flush.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  let completion!:Promise<void>;
  await act(async()=>{completion=mocks.onPublished!();});
  expect(mocks.clear).not.toHaveBeenCalled();expect(host.querySelector('.success-toast')).toBeNull();
  await act(async()=>{finish();await completion;});
  expect(host.textContent).toContain('文章列表');expect(host.textContent).not.toContain('编辑文章');expect(location.search).toBe('');
  expect(host.querySelector('.success-toast')?.textContent).toBe('已发布');
});
