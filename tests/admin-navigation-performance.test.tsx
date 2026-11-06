// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../apps/admin/src/App.tsx';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
const mocks = vi.hoisted(() => ({ api: vi.fn(), flush: vi.fn(), select: vi.fn(), selection: { current: 0 }, session: { record: null }, settings: { state: {}, resumePending: vi.fn() } }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: Object.assign(mocks.api, { request: mocks.api }) }));
vi.mock('../apps/admin/src/EditSessions.tsx', () => ({ useEditSessions: () => ({ flush: mocks.flush }) }));
vi.mock('../apps/admin/src/Fields.tsx', () => ({ FieldWidgetsProvider: ({ children }: any) => children }));
vi.mock('../apps/admin/src/useContentWorkspace.ts', () => ({ useContentWorkspace: () => ({editor:{record:null,dirty:false},library:{},dialogs:{},navigation:{current:()=>mocks.session.record,version:()=>mocks.selection.current,cancelSelection:()=>{++mocks.selection.current;},select:mocks.select,clear:vi.fn()}}) }));
vi.mock('../apps/admin/src/usePublication.ts', () => ({ usePublication: () => ({}) }));
vi.mock('../apps/admin/src/useSettingsApplication.ts', () => ({ useSettingsApplication: () => mocks.settings }));
vi.mock('../apps/admin/src/ContentLibrary.tsx', () => ({ ContentLibrary: () => <p>文章列表</p> }));
vi.mock('../apps/admin/src/NotesLibrary.tsx', () => ({ NotesLibrary: () => <p>笔记列表</p> }));
vi.mock('../apps/admin/src/NoteEditor.tsx', () => ({ NoteEditor: () => null }));
vi.mock('../apps/admin/src/EntryEditor.tsx', () => ({ EntryEditor: () => null }));
vi.mock('../apps/admin/src/ContentDialogs.tsx', () => ({ ContentDialogs: () => null }));
vi.mock('../apps/admin/src/PublicationDialog.tsx', () => ({ PublicationDialog: () => null }));
vi.mock('../apps/admin/src/Reauthentication.tsx', () => ({ Reauthentication: () => null }));
vi.mock('../apps/admin/src/Comments.tsx', () => ({ default: () => <p>评论列表</p> }));
vi.mock('../apps/admin/src/MediaManager.tsx', () => ({ default: () => <p>媒体列表</p> }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const state = { settings: { value: { name: '站点', logo: '' } }, types: [], fieldWidgets: {} };
beforeEach(() => {
  adminQueries.invalidate(true); mocks.api.mockReset(); mocks.flush.mockReset().mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/admin/');
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (label: string) => [...host.querySelectorAll('nav button')].find(node => node.textContent === label) as HTMLButtonElement;
const render = async () => { await act(async () => root.render(<App authentication={{ session: { authenticated: true } } as any} error="" setError={vi.fn()} />)); };
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
