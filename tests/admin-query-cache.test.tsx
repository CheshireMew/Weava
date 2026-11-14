// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryCache, adminQueries } from '../apps/admin/src/query-cache.ts';
import { useAdminQuery } from '../apps/admin/src/useAdminQuery.ts';
import { api } from '../apps/admin/src/api.ts';
import { useAdminState } from '../apps/admin/src/useAdminState.ts';
import { useAdminSession } from '../apps/admin/src/useAdminSession.ts';
vi.mock('../apps/admin/src/api.ts', () => { const request = vi.fn(); return { api: Object.assign(request, { request }) }; });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
it('revalidates authored data on job completion rather than merely queueing work',async()=>{
 const {adminApi}=await import('../packages/contracts/src/admin-api.ts');const {submissionDomains}=await import('../apps/admin/src/query-effects.ts');
 for(const [operation,definition] of Object.entries(adminApi))if(definition.status===202&&operation!=='updateGeo')expect(submissionDomains(definition.path,{}),definition.path).toEqual(['operations']);
 expect(submissionDomains('analytics/geo',{})).toEqual(['analytics']);
 const cache=new QueryCache(),content=vi.fn(async()=>({saved:true}));await cache.read('content',content);
 const end=cache.beginWrite(key=>key==='operations');end(key=>key==='operations');await cache.read('content',content);expect(content).toHaveBeenCalledTimes(1);
 cache.invalidate(false,key=>key==='content');await cache.read('content',content);expect(content).toHaveBeenCalledTimes(2);
});
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { adminQueries.invalidate(true); vi.mocked(api).mockReset(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('coalesces requests, reuses fresh results and keeps expired data visible while revalidating', async () => {
  let clock = 0; const cache = new QueryCache(10, 10000, () => clock), first = pending<string>();
  const read = vi.fn(() => first.promise);
  const one = cache.read('a', read), two = cache.read('a', read);
  expect(one).toBe(two); first.resolve('first'); await one;
  await cache.read('a', read); expect(read).toHaveBeenCalledTimes(1);
  clock = 30001; const update = pending<string>(), next = cache.read('a', () => update.promise);
  expect(cache.snapshot('a')).toMatchObject({ data: 'first', pending: true });
  update.resolve('second'); await next; expect(cache.snapshot('a')).toMatchObject({ data: 'second', pending: false });
});
it('cannot restore an old response after a save or a session reset', async () => {
  const cache = new QueryCache(), old = pending<string>();
  const before = cache.read('a', () => old.promise);
  cache.invalidate(true);
  expect(cache.snapshot('a').data).toBeUndefined();
  await cache.read('a', async () => 'saved'); old.resolve('outdated');
  expect(await before).toBe('saved'); expect(cache.snapshot('a').data).toBe('saved');
});
it('bounds retained results by count and memory, and never caches a failed request as success', async () => {
  const cache = new QueryCache(2, 40);
  await cache.read('a', async () => 'aaaaaaaa'); await cache.read('b', async () => 'bbbbbbbb'); await cache.read('c', async () => 'cccccccc');
  expect(cache.snapshot('a').data).toBeUndefined();
  await expect(cache.read('failed', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  expect(cache.snapshot('failed').data).toBeUndefined();
  expect(await cache.read('failed', async () => 'recovered')).toBe('recovered');
});
it('stops authenticated reads after session expiry until login resumes the cache', async () => {
  const cache = new QueryCache(), read = vi.fn(async () => 'private');
  await cache.read('a', read); cache.suspend(); expect(cache.snapshot('a').data).toBeUndefined();
  await expect(cache.read('a', read)).rejects.toThrow('重新登录'); expect(read).toHaveBeenCalledTimes(1);
  cache.resume(); expect(await cache.read('a', read)).toBe('private'); expect(read).toHaveBeenCalledTimes(2);
});
it('fences in-flight reads during a write and revalidates only after the commit',async()=>{
 const cache=new QueryCache(),old=pending<string>(),load=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('committed');
 const reading=cache.read('entries',load);await Promise.resolve();const finish=cache.beginWrite(key=>key==='entries');
 old.resolve('before commit');await Promise.resolve();await Promise.resolve();expect(load).toHaveBeenCalledTimes(1);
 const during=cache.read('entries',load);await Promise.resolve();expect(load).toHaveBeenCalledTimes(1);
 finish();expect(await reading).toBe('committed');expect(await during).toBe('committed');expect(load).toHaveBeenCalledTimes(2);
});
it('renders the matching cached query immediately, refreshes after writes and never shows a different filter', async () => {
  let model: ReturnType<typeof useAdminQuery<string>>;
  function View({ path }: { path: string }) { model = useAdminQuery<string>(path); return <div>{model.data ?? 'loading'}</div>; }
  vi.mocked(api).mockResolvedValue('articles' as any);
  await act(async () => root.render(<View path="articles" />));
  vi.mocked(api).mockResolvedValue('notes' as any);
  await act(async () => root.render(<View path="notes" />)); expect(host.textContent).toBe('notes');
  await act(async () => root.render(<View path="articles" />)); expect(host.textContent).toBe('articles'); expect(api).toHaveBeenCalledTimes(2);
  const update = pending<string>(); vi.mocked(api).mockReturnValue(update.promise as any);
  await act(async () => adminQueries.invalidate()); expect(host.textContent).toBe('articles'); expect(model!.pending).toBe(true);
  expect(model!.loading).toBe(false); expect(model!.refreshing).toBe(true);
  await act(async () => update.resolve('saved articles')); expect(host.textContent).toBe('saved articles');
  const filtered = pending<string>(); vi.mocked(api).mockReturnValue(filtered.promise as any);
  await act(async () => root.render(<View path="articles?q=other" />)); expect(host.textContent).toBe('loading');
  expect(model!.loading).toBe(true); expect(model!.refreshing).toBe(false);
  await act(async () => filtered.resolve('filtered')); expect(host.textContent).toBe('filtered');
});
it('reloads a failed visible query when the browser reconnects',async()=>{
  function View(){const data=useAdminQuery<string>('offline-query');return <p>{data.error||data.data}</p>;}
  vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered' as any);
  await act(async()=>root.render(<View/>)); expect(host.textContent).toBe('offline');
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(host.textContent).toBe('recovered'); expect(api).toHaveBeenCalledTimes(2);
});
it('recovers the initial session read after an outage without treating it as a logout',async()=>{
  const error=vi.fn();
  function View(){const model=useAdminSession(error);return <p>{model.session?.authenticated?'ready':'waiting'}</p>;}
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('offline'),{status:0})).mockResolvedValue({authenticated:true} as any);
  await act(async()=>root.render(<View/>));expect(host.textContent).toBe('waiting');
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(host.textContent).toBe('ready');expect(error).toHaveBeenLastCalledWith('');
});
it('coalesces mutation refreshes with the active query, preserves editor schedules and still honors manual refresh', async () => {
  let model!: ReturnType<typeof useAdminState>, selected: any = null;
  const activeTab = { current: 'content' }, initial: any = { settings: { value: { name: 'first' } }, schedules: [] };
  function View() { model = useAdminState({ authenticated: true, tab: 'content', activeTab, setTab: vi.fn(), setError: vi.fn(), currentEntry: () => selected }); return <p>{model.state?.settings.value.name}</p>; }
  vi.mocked(api).mockResolvedValue(initial);
  await act(async () => root.render(<View />));expect(api).toHaveBeenCalledTimes(1);
  selected = { id: 'article' };const schedules = [{ id: 'scheduled-publication' }] as any;
  await act(async () => model.receiveSchedules(schedules));
  const update = pending<any>();vi.mocked(api).mockReturnValue(update.promise);
  let sync!: Promise<any>;
  await act(async () => { adminQueries.invalidate(); sync = model.sync(); });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => { update.resolve({ ...initial, settings: { value: { name: 'saved' } } }); await sync; });
  expect(host.textContent).toBe('saved');expect(model.state?.schedules).toEqual(schedules);
  await act(async () => model.sync());expect(api).toHaveBeenCalledTimes(2);
  vi.mocked(api).mockResolvedValue(initial);await act(async () => model.refresh());expect(api).toHaveBeenCalledTimes(3);
  expect([...new Set(vi.mocked(api).mock.calls.map(([path]) => path))]).toEqual(['state?summary=1&panel=content']);
});
