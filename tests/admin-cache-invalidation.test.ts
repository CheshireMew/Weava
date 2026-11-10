import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api, waitJob } from '../apps/admin/src/api.ts';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
const mocks = vi.hoisted(() => ({ request: vi.fn(), call: vi.fn(), expire: () => {} }));
vi.mock('@weava/contracts/api-client', () => ({ createAdminClient: (options: any) => {
  mocks.expire = options.onUnauthorized; return { request: mocks.request, call: mocks.call };
} }));
beforeEach(() => { adminQueries.resume(); mocks.request.mockReset().mockResolvedValue({ saved: true }); mocks.call.mockReset().mockResolvedValue({ saved: true }); });
afterEach(()=>vi.unstubAllGlobals());
it('does not fence content or settings reads while an import preview is being submitted',async()=>{
 let finish!:(value:any)=>void;mocks.request.mockReturnValueOnce(new Promise(resolve=>finish=resolve));
 const preview=api.request('import/wxr',{xml:'<rss/>',options:{dryRun:true}});
 expect(await adminQueries.read('entries',async()=>'readable content')).toBe('readable content');
 expect(await adminQueries.read('settings',async()=>'readable settings')).toBe('readable settings');
 finish({id:'preview',status:'queued'});await preview;
});
it('refreshes taxonomy projections after an article write while retaining unrelated media and analytics',async()=>{
 for(const path of ['state?summary=1&panel=content','media/query','analytics'])await adminQueries.read(path,async()=>path);
 await api.request('entry',{revision:1});
 expect(await adminQueries.read('state?summary=1&panel=content',async()=>'updated terms')).toBe('updated terms');
 for(const path of ['media/query','analytics'])expect(await adminQueries.read(path,async()=>'unnecessary reload')).toBe(path);
});
it('resolves a failed logout against the actual session and offers reauthentication if it cannot be confirmed',async()=>{
 const fetch=vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json({authenticated:true,initialized:true,version:'test'}));vi.stubGlobal('fetch',fetch);
 await expect(api('logout',{})).rejects.toThrow('无法连接');expect(await adminQueries.read('state',async()=>'still signed in')).toBe('still signed in');
 const expired=vi.fn();vi.stubGlobal('window',{dispatchEvent:expired});fetch.mockRejectedValue(new Error('offline'));
 await expect(api('logout',{})).rejects.toThrow('无法连接');expect(expired).toHaveBeenCalled();await expect(adminQueries.read('state',async()=>'private')).rejects.toThrow('重新登录');
});
it('preserves the structured reason for a failed worker job',async()=>{
 await expect(waitJob({id:'failed',operation:'publish',status:'failed',message:'conflict',errorStatus:409,errorDetails:{revision:7}},()=>{})).rejects.toMatchObject({status:409,details:{jobId:'failed',cause:{revision:7}}});
});
it('refreshes analytics and health after an archive job finishes, retaining unrelated content',async()=>{
 for(const path of ['analytics?section=overview','analytics/health','entry/unrelated'])await adminQueries.read(path,async()=>'before archive');
 mocks.request.mockResolvedValueOnce({id:'archive',operation:'analytics-archive',status:'complete'});
 await api.request('analytics/archive',{before:'2026-11-01',review:'review'});
 for(const path of ['analytics?section=overview','analytics/health'])expect(await adminQueries.read(path,async()=>'after archive')).toBe('after archive');
 expect(await adminQueries.read('entry/unrelated',async()=>'unnecessary read')).toBe('before archive');
});
it('invalidates affected display queries once after a write, including failed writes and typed calls', async () => {
  await adminQueries.read('entries', async () => 'old');
  const before = adminQueries.snapshot('entries').invalidation;
  await api.request('entry', { revision: 1 });
  expect(adminQueries.snapshot('entries').invalidation).toBeGreaterThan(before);
  expect(await adminQueries.read('entries', async () => 'saved')).toBe('saved');
  mocks.request.mockRejectedValueOnce(new Error('write failed'));
  await expect(api.request('entry', { revision: 2 })).rejects.toThrow('write failed');
  expect(await adminQueries.read('entries', async () => 'rechecked')).toBe('rechecked');
  await api.call('saveSettings', { body: {} } as any);
  expect(await adminQueries.read('entries', async () => 'typed call')).toBe('rechecked');
});
it('always reads editor records from the server, clears display data on expiry and refreshes it after jobs', async () => {
  await adminQueries.read('entry/example', async () => 'cached editor value');
  await api.request('entry/example'); await api.request('entry/example'); expect(mocks.request).toHaveBeenCalledTimes(2);
  await waitJob({ status: 'complete',operation:'publish' }, () => {});
  expect(await adminQueries.read('entry/example', async () => 'published')).toBe('published');
  mocks.expire(); expect(adminQueries.snapshot('entry/example').data).toBeUndefined();
  const fetch = vi.fn(async () => 'must not run');
  await expect(adminQueries.read('entry/example', fetch)).rejects.toThrow('重新登录'); expect(fetch).not.toHaveBeenCalled();
});
