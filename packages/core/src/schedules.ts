import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { now, uuid } from './storage.ts';
import {preparePublication, commitPublication, assertPublicationCurrent, type PreparedPublication} from './publication.ts';
import { runPublicationPlans } from './publication-plans.ts';
import type {Release} from '@weava/contracts';
import type {JobRunner} from './job-runner.ts';

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
export function schedules(site: Site, entryId?: string) {
  if (entryId) return (site.store.raw.prepare("SELECT id,revision,data,updated_at FROM records WHERE scope=? AND json_extract(data,'$.entryId')=? ORDER BY updated_at DESC").all(scope,entryId) as {id:string;revision:number;data:string;updated_at:string}[]).map(row=>({id:row.id,revision:row.revision,value:JSON.parse(row.data),updatedAt:row.updated_at}));
  return site.store.list(scope).sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt));
}
export function schedulePublication(site: Site, entryId: string, revision: number, dueAt: string, clock = Date.now()) {
  const time = Date.parse(dueAt);
  if (!Number.isFinite(time) || time <= clock) throw new WeavaError('定时发布时间需要晚于当前时间。');
  const prepared=preparePublication(site,{ids:[entryId],revisions:{[entryId]:revision}});
  return site.store.raw.transaction(() => {
    assertPublicationCurrent(site,prepared);
    const row = site.store.get('entry', entryId);
    if (!row || row.revision !== revision) throw new WeavaError('待定时发布的内容已变化，请重新载入。', 409);
    if (row.value.status === 'archived') throw new WeavaError('请先将归档内容恢复为草稿。');
    if (schedules(site).some((item) => item.value.entryId === entryId && ['scheduled', 'running'].includes(item.value.status)))
      throw new WeavaError('这份内容已有待执行的发布，请先取消原计划。', 409);
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
const competingPublication=(site:Site,jobId='')=>!!site.store.raw.prepare("SELECT 1 FROM jobs WHERE operation='publish' AND status IN ('queued','running') AND id<>? LIMIT 1").get(jobId);
function failSchedule(site:Site,id:string,revision:number,error:any){
  if(error.status===409)return;
  site.store.raw.transaction(()=>{const row=site.store.get(scope,id);if(row?.revision===revision&&row.value.status==='scheduled')site.store.put(scope,id,{...row.value,status:'failed',attempts:row.value.attempts+1,error:error.message},revision,'定时发布失败');}).immediate();
}
function commitSchedule(site:Site,row:NonNullable<ReturnType<Site['store']['get']>>,prepared:PreparedPublication,clock:number,jobId?:string){
  try{assertPublicationCurrent(site,prepared);}catch(error:any){if(error.status===409)return null;throw error;}
  return commitPublication(site,prepared,{jobId},release=>{
    site.store.put(scope,row.id,{...row.value,status:'complete',attempts:row.value.attempts+1,releaseId:release.id,completedAt:new Date(clock).toISOString()},row.revision,'定时发布完成');
  },()=>{
    const current=site.store.get(scope,row.id);
    if(current?.revision!==row.revision||current.value.status!=='scheduled'||competingPublication(site,jobId))throw new WeavaError('定时计划已变化，请等待下一次检查。',409);
  });
}
function dueSchedules(site:Site,clock:number){
  return (site.store.raw.prepare("SELECT id FROM records WHERE scope='publication-schedule' AND json_extract(data,'$.status')='scheduled' AND json_extract(data,'$.dueAt')<=? ORDER BY json_extract(data,'$.dueAt'),id LIMIT 20").all(new Date(clock).toISOString()) as {id:string}[]).map(row=>site.store.get(scope,row.id)!);
}
export function runSchedules(site: Site, clock = Date.now(), onlyId?:string, reviewRevision?:number|null, baseReleaseId?:string|null) {
  const completed:string[]=[],failed:string[]=[];
  for(const row of dueSchedules(site,clock).filter(row=>!onlyId||row.id===onlyId)){
    if(competingPublication(site))break;
    if(reviewRevision!==undefined&&(reviewRevision!==(site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as any).n||baseReleaseId!==(site.store.state('release')??null)))break;
    try{
      const prepared=preparePublication(site,{ids:[row.value.entryId],versions:{[row.value.entryId]:row.value.entryRevision},label:'定时发布'});
      if(commitSchedule(site,row,prepared,clock))completed.push(row.id);
    }catch(error:any){failSchedule(site,row.id,row.revision,error);if(site.store.get(scope,row.id)?.value.status==='failed')failed.push(row.id);}
  }
  return {completed,failed};
}
export async function runScheduledPublication(site:Site,id:string,revision:number,validate:(release:Release)=>Promise<void>,clock=Date.now(),jobId?:string){
  const row=site.store.get(scope,id);
  if(!row||row.revision!==revision||row.value.status!=='scheduled'||Date.parse(row.value.dueAt)>clock||competingPublication(site,jobId))return null;
  try{
    const prepared=preparePublication(site,{ids:[row.value.entryId],versions:{[row.value.entryId]:row.value.entryRevision},label:'定时发布'});
    await validate(prepared.release);
    return commitSchedule(site,row,prepared,clock,jobId);
  }catch(error:any){failSchedule(site,id,revision,error);if(error.status===409)return null;throw error;}
}
export async function runSchedulesAsync(site:Site,validate:(release:Release)=>Promise<void>,clock=Date.now()){
  await runPublicationPlans(site,validate,clock);
  const completed:string[]=[],failed:string[]=[];
  for(const row of dueSchedules(site,clock)){
    if(competingPublication(site))break;
    try{if(await runScheduledPublication(site,row.id,row.revision,validate,clock))completed.push(row.id);}
    catch{failed.push(row.id);}
  }
  return {completed,failed};
}
/** The live site's timer only selects and queues work. Preparation runs in the managed worker. */
export function queueScheduledPublications(site:Site,jobs:Pick<JobRunner,'enqueue'>,clock=Date.now()){
  if(competingPublication(site))return;
  const row=site.store.raw.prepare("SELECT scope,id,revision FROM records WHERE scope IN ('publication-schedule','publication-plan') AND json_extract(data,'$.status')='scheduled' AND json_extract(data,'$.dueAt')<=? ORDER BY json_extract(data,'$.dueAt'),id LIMIT 1").get(new Date(clock).toISOString()) as {scope:string;id:string;revision:number}|undefined;
  if(!row)return;
  jobs.enqueue('publish',row.scope==='publication-plan'?{planId:row.id,planRevision:row.revision}:{scheduleId:row.id,scheduleRevision:row.revision});
}
