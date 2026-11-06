// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryCache, adminQueries } from '../apps/admin/src/query-cache.ts';
import { useAdminQuery } from '../apps/admin/src/useAdminQuery.ts';
import { api } from '../apps/admin/src/api.ts';
vi.mock('../apps/admin/src/api.ts', () => ({ api: vi.fn() }));
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
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
  await act(async () => update.resolve('saved articles')); expect(host.textContent).toBe('saved articles');
  const filtered = pending<string>(); vi.mocked(api).mockReturnValue(filtered.promise as any);
  await act(async () => root.render(<View path="articles?q=other" />)); expect(host.textContent).toBe('loading');
  await act(async () => filtered.resolve('filtered')); expect(host.textContent).toBe('filtered');
});
