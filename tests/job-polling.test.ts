import {afterEach,expect,it,vi} from 'vitest';
import {api,waitJob} from '../apps/admin/src/api.ts';
import {adminQueries} from '../apps/admin/src/query-cache.ts';
const job=(status:string)=>({id:'test-job',operation:'publish',status,createdAt:'2026-11-08',updatedAt:'2026-11-08',message:status==='failed'?'发布失败':'正在启动任务'});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();adminQueries.invalidate(true);});
it('detects short jobs early, backs off long jobs and invalidates display data only at completion',async()=>{
 const fetch=vi.fn(async()=>Response.json(job('running')));vi.stubGlobal('fetch',fetch);adminQueries.resume();
 await api('job/test-job');fetch.mockClear();
 await adminQueries.read('entries/query?page=1',async()=>['before']);const original=adminQueries.snapshot('entries/query?page=1').invalidation;
 vi.useFakeTimers();const progress=vi.fn(),waiting=waitJob(job('queued'),progress);
 await vi.advanceTimersByTimeAsync(149);expect(fetch).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(300);expect(fetch).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(500);expect(fetch).toHaveBeenCalledTimes(3);
 expect(adminQueries.snapshot('entries/query?page=1').invalidation).toBe(original);
 fetch.mockResolvedValue(Response.json(job('complete')));
 await vi.advanceTimersByTimeAsync(500);expect((await waiting).status).toBe('complete');expect(fetch).toHaveBeenCalledTimes(4);
 expect(adminQueries.snapshot('entries/query?page=1').invalidation).toBeGreaterThan(original);
});
it('keeps job failures and interrupted progress reads actionable',async()=>{
 await expect(waitJob({...job('failed'),errorStatus:409},vi.fn())).rejects.toMatchObject({message:'发布失败',status:409,details:{jobId:'test-job'}});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));vi.useFakeTimers();
 const waiting=expect(waitJob(job('running'),vi.fn())).rejects.toMatchObject({details:{jobId:'test-job'},message:expect.stringContaining('任务可能仍在执行')});
 await vi.advanceTimersByTimeAsync(150);await waiting;
});
