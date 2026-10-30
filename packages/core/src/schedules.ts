import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { now, uuid } from './storage.ts';
import {preparePublication} from './publication.ts';
import { runPublicationPlans } from './publication-plans.ts';
import type {Release} from '@weava/contracts';

export interface PublicationSchedule {
  id: string;
  entryId: string;
  entryRevision: number;
  dueAt: string;
  status: 'scheduled' | 'running' | 'complete' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: string;
  completedAt?: string;
  releaseId?: string;
  error?: string;
}
const scope = 'publication-schedule';
export function schedules(site: Site) {
  return site.store.list(scope).sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt));
}
export function schedulePublication(site: Site, entryId: string, revision: number, dueAt: string, clock = Date.now()) {
  const time = Date.parse(dueAt);
  if (!Number.isFinite(time) || time <= clock) throw new WeavaError('定时发布时间需要晚于当前时间。');
  return site.store.raw.transaction(() => {
    const row = site.store.get('entry', entryId);
    if (!row || row.revision !== revision) throw new WeavaError('待定时发布的内容已变化，请重新载入。', 409);
    if (row.value.status === 'archived') throw new WeavaError('请先将归档内容恢复为草稿。');
    if (schedules(site).some((item) => item.value.entryId === entryId && ['scheduled', 'running'].includes(item.value.status)))
      throw new WeavaError('这份内容已有待执行的发布，请先取消原计划。', 409);
    site.previewPublication({ ids: [entryId], revisions: { [entryId]: revision } });
    const value: PublicationSchedule = { id: uuid(), entryId, entryRevision: revision, dueAt: new Date(time).toISOString(), status: 'scheduled', attempts: 0, createdAt: now() };
    return site.store.put(scope, value.id, value, null, '安排定时发布');
  }).immediate();
}
export function cancelSchedule(site: Site, id: string, revision: number) {
  return site.store.raw.transaction(() => {
    const row = site.store.get(scope, id);
    if (!row || row.revision !== revision) throw new WeavaError('定时计划已变化，请重新载入。', 409);
    if (!['scheduled', 'failed'].includes(row.value.status)) throw new WeavaError('这个计划当前不能取消。', 409);
    return site.store.put(scope, id, { ...row.value, status: 'cancelled' }, revision, '取消定时发布');
  }).immediate();
}
export function retrySchedule(site: Site, id: string, revision: number, clock = Date.now()) {
  return site.store.raw.transaction(() => {
    const row = site.store.get(scope, id);
    if (!row || row.revision !== revision || row.value.status !== 'failed') throw new WeavaError('只有当前失败的定时计划可以重试。', 409);
    if (schedules(site).some((other) => other.id !== row.id && other.value.entryId === row.value.entryId && ['scheduled', 'running'].includes(other.value.status)))
      throw new WeavaError('这份内容已有另一项待执行的发布。', 409);
    return site.store.put(scope, id, { ...row.value, status: 'scheduled', dueAt: new Date(clock).toISOString(), error: undefined }, revision, '重试定时发布');
  }).immediate();
}
export function runSchedules(site: Site, clock = Date.now(), onlyId?:string, reviewRevision?:number, baseReleaseId?:string|null) {
  const completed: string[] = [], failed: string[] = [];
  for (const queued of schedules(site).filter((row) => (!onlyId||row.id===onlyId)&&row.value.status === 'scheduled' && Date.parse(row.value.dueAt) <= clock).slice(0, 20)) {
    try {
      const committed = site.store.raw.transaction(() => {
        const row = site.store.get(scope, queued.id);
        if (!row || row.value.status !== 'scheduled') return;
        if (site.store.raw.prepare("SELECT 1 FROM jobs WHERE operation='publish' AND status IN ('queued','running')").get()) return;
        if(reviewRevision!==undefined&&(reviewRevision!==(site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as any).n||baseReleaseId!==(site.store.state('release')??null)))return;
        const running = site.store.put(scope, row.id, { ...row.value, status: 'running', attempts: row.value.attempts + 1 }, row.revision, '开始定时发布');
        // Claim, publication pointer, result and completion are committed together.
        // A stopped process rolls the transaction back, leaving the plan due for restart.
        const release = site.publish({ ids: [row.value.entryId], versions: { [row.value.entryId]: row.value.entryRevision }, label: '定时发布' });
        site.store.put(scope, row.id, { ...running.value, status: 'complete', releaseId: release.id, completedAt: new Date(clock).toISOString() }, running.revision, '定时发布完成');
        return true;
      }).immediate();
      if (committed) completed.push(queued.id);
    } catch (error: any) {
      site.store.raw.transaction(() => {
        const current = site.store.get(scope, queued.id);
        if (current?.value.status === 'scheduled') {
          site.store.put(scope, current.id, { ...current.value, status: 'failed', attempts: current.value.attempts + 1, error: error.message }, current.revision, '定时发布失败');
          failed.push(current.id);
        }
      }).immediate();
    }
  }
  return { completed, failed };
}
export async function runSchedulesAsync(site:Site,validate:(release:Release)=>Promise<void>,clock=Date.now()){
  await runPublicationPlans(site, validate, clock);
  const completed:string[]=[],failed:string[]=[];
  for(const queued of schedules(site).filter((row)=>row.value.status==='scheduled'&&Date.parse(row.value.dueAt)<=clock).slice(0,20)){
    if(site.store.raw.prepare("SELECT 1 FROM jobs WHERE operation='publish' AND status IN ('queued','running')").get())break;
    try{
      const review=site.previewPublication({ids:[queued.value.entryId],versions:{[queued.value.entryId]:queued.value.entryRevision},label:'定时发布'});
      await validate(preparePublication(site,review.options).release);
      const result=runSchedules(site,clock,queued.id,review.options.reviewRevision,review.options.baseReleaseId);completed.push(...result.completed);failed.push(...result.failed);
    }catch(error:any){site.store.raw.transaction(()=>{const current=site.store.get(scope,queued.id);if(current?.revision===queued.revision&&current.value.status==='scheduled'){site.store.put(scope,current.id,{...current.value,status:'failed',attempts:current.value.attempts+1,error:error.message},current.revision,'定时发布失败');failed.push(current.id);}}).immediate();}
  }
  return {completed,failed};
}
