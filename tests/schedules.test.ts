import { afterEach, describe, expect, it } from 'vitest';
import { Site, schedulePublication, runSchedules, schedules, cancelSchedule, retrySchedule,runSchedulesAsync } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/schedules-' + Date.now();
const sites: Site[] = [];
let sequence = 0;
function create() { const site = new Site(base + '/' + sequence++); sites.push(site);
  site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null); return site; }
const original = () => entrySchema.parse({ id: 'one', title: '定时指定的版本', path: '/one/', kind: 'content' });
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('persistent scheduled publication', () => {
  it('publishes the selected immutable revision after reopening while keeping later edits as drafts', () => {
    const site = create(), row = site.saveEntry(original(), null), time = Date.now();
    const plan = schedulePublication(site, row.id, row.revision, new Date(time + 10000).toISOString(), time);
    expect(runSchedules(site, time).completed).toHaveLength(0);
    site.saveEntry({ ...row.value, title: '之后的工作稿' }, row.revision);
    const reopened = new Site(site.root); sites.push(reopened);
    expect(runSchedules(reopened, time + 20000).completed).toEqual([plan.id]);
    expect(reopened.release()!.entries[0].title).toBe('定时指定的版本');
    expect(reopened.store.get('entry', row.id)!.value.title).toBe('之后的工作稿');
    expect(schedules(reopened)[0].value.status).toBe('complete');
    expect(runSchedules(site, time + 30000).completed).toEqual([]);
    expect(site.releases()).toHaveLength(1);
  });
  it('supports cancellation with conflict checks and prevents duplicate pending plans', () => {
    const site = create(), row = site.saveEntry(original(), null), time = Date.now();
    const plan = schedulePublication(site, row.id, row.revision, new Date(time + 10000).toISOString(), time);
    expect(() => schedulePublication(site, row.id, row.revision, new Date(time + 20000).toISOString(), time)).toThrow(/已有/);
    expect(() => cancelSchedule(site, plan.id, plan.revision + 1)).toThrow(/已变化/);
    cancelSchedule(site, plan.id, plan.revision);
    expect(runSchedules(site, time + 30000).completed).toEqual([]);
    expect(site.release()).toBeNull();
  });
  it('leaves the current release intact on a failed candidate, reports failure and retries the same revision', () => {
    const site = create(), row = site.saveEntry(original(), null), first = site.publish({ ids: ['one'] }), time = Date.now();
    const changed = site.saveEntry({ ...row.value, title: '排期修改' }, row.revision);
    const plan = schedulePublication(site, row.id, changed.revision, new Date(time + 10000).toISOString(), time);
    site.publicationValidators.push(() => { throw new Error('模拟渲染失败'); });
    expect(runSchedules(site, time + 20000).failed).toEqual([plan.id]);
    expect(site.release()!.id).toBe(first.id);
    const failed = schedules(site)[0]; expect(failed.value.error).toContain('模拟渲染失败');
    site.publicationValidators.length = 0;
    retrySchedule(site, failed.id, failed.revision, time + 30000);
    expect(runSchedules(site, time + 30000).completed).toEqual([plan.id]);
    expect(site.release()!.entries[0].title).toBe('排期修改');
    expect(schedules(site)[0].value.attempts).toBe(2);
  });
  it('waits for an ordinary publication job rather than competing with its queued candidate', () => {
    const site = create(), row = site.saveEntry(original(), null), time = Date.now();
    const plan = schedulePublication(site, row.id, row.revision, new Date(time + 1000).toISOString(), time);
    const job = site.createJob('publish');
    expect(runSchedules(site, time + 2000)).toEqual({ completed: [], failed: [] });
    expect(schedules(site)[0].value.status).toBe('scheduled');
    site.updateJob(job.id, { status: 'complete' });
    expect(runSchedules(site, time + 2000).completed).toEqual([plan.id]);
  });
  it('checks asynchronous final renderers before claiming a scheduled revision, leaving the old release on failure',async()=>{
    const site=create(),row=site.saveEntry({...original(),status:'published'},null),first=site.publish(),time=Date.now();const plan=schedulePublication(site,row.id,row.revision,new Date(time+1000).toISOString(),time);
    const result=await runSchedulesAsync(site,async()=>{throw new Error('final async renderer failed');},time+2000);expect(result.failed).toEqual([plan.id]);expect(site.release()!.id).toBe(first.id);expect(schedules(site)[0].value.error).toContain('final async renderer failed');
  });
  it('rechecks a candidate after asynchronous rendering and leaves a changed review pending for the next tick',async()=>{
    const site=create(),row=site.saveEntry(original(),null),time=Date.now(),plan=schedulePublication(site,row.id,row.revision,new Date(time+1000).toISOString(),time);
    const result=await runSchedulesAsync(site,async()=>{site.saveEntry({...row.value,title:'验证期间的新工作稿'},row.revision);},time+2000);expect(result.completed).toEqual([]);expect(schedules(site)[0].value.status).toBe('scheduled');expect(site.release()).toBeNull();
    expect((await runSchedulesAsync(site,async()=>{},time+3000)).completed).toEqual([plan.id]);expect(site.release()!.entries[0].title).toBe('定时指定的版本');
  });
});
