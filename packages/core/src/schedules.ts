import type { Release } from '@weava/contracts';
import { WeavaError } from '@weava/contracts';
import { now, uuid } from '../../runtime-common/src/identity.ts';
import type { JobRunner } from './job-runner.ts';
import {
  commitTrackedPublication,
  hasCompetingPublication as competingPublication,
  executeTrackedPublication,
  failTrackedPublication,
  type PublicationExecution,
} from './publication-execution.ts';
import { runPublicationPlans } from './publication-plans.ts';
import { duePublications } from './publication-time.ts';
import {
  assertPublicationCurrent,
  preparePublication,
  RetryablePublicationConflict,
} from './publication.ts';
import type { Site } from './site.ts';

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
  if (entryId)
    return (
      site.store.raw
        .prepare(
          "SELECT id,revision,data,updated_at FROM records WHERE scope=? AND json_extract(data,'$.entryId')=? ORDER BY updated_at DESC",
        )
        .all(scope, entryId) as { id: string; revision: number; data: string; updated_at: string }[]
    ).map((row) => ({
      id: row.id,
      revision: row.revision,
      value: JSON.parse(row.data),
      updatedAt: row.updated_at,
    }));
  return site.store.list(scope).sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt));
}
export function schedulePublication(
  site: Site,
  entryId: string,
  revision: number,
  dueAt: string,
  clock = Date.now(),
) {
  const time = Date.parse(dueAt);
  if (!Number.isFinite(time) || time <= clock)
    throw new WeavaError('定时发布时间需要晚于当前时间。');
  const prepared = preparePublication(site, { ids: [entryId], revisions: { [entryId]: revision } });
  return site.store.raw
    .transaction(() => {
      assertPublicationCurrent(site, prepared);
      const row = site.store.get('entry', entryId);
      if (!row || row.revision !== revision)
        throw new WeavaError('待定时发布的内容已变化，请重新载入。', 409);
      if (row.value.status === 'archived') throw new WeavaError('请先将归档内容恢复为草稿。');
      if (
        schedules(site).some(
          (item) =>
            item.value.entryId === entryId && ['scheduled', 'running'].includes(item.value.status),
        )
      )
        throw new WeavaError('这份内容已有待执行的发布，请先取消原计划。', 409);
      const value: PublicationSchedule = {
        id: uuid(),
        entryId,
        entryRevision: revision,
        dueAt: new Date(time).toISOString(),
        status: 'scheduled',
        attempts: 0,
        createdAt: now(),
      };
      return site.store.put(scope, value.id, value, null, '安排定时发布');
    })
    .immediate();
}
export function cancelSchedule(site: Site, id: string, revision: number) {
  return site.store.raw
    .transaction(() => {
      const row = site.store.get(scope, id);
      if (!row || row.revision !== revision)
        throw new WeavaError('定时计划已变化，请重新载入。', 409);
      if (!['scheduled', 'failed'].includes(row.value.status))
        throw new WeavaError('这个计划当前不能取消。', 409);
      return site.store.put(
        scope,
        id,
        { ...row.value, status: 'cancelled' },
        revision,
        '取消定时发布',
      );
    })
    .immediate();
}
export function retrySchedule(site: Site, id: string, revision: number, clock = Date.now()) {
  return site.store.raw
    .transaction(() => {
      const row = site.store.get(scope, id);
      if (!row || row.revision !== revision || row.value.status !== 'failed')
        throw new WeavaError('只有当前失败的定时计划可以重试。', 409);
      if (
        schedules(site).some(
          (other) =>
            other.id !== row.id &&
            other.value.entryId === row.value.entryId &&
            ['scheduled', 'running'].includes(other.value.status),
        )
      )
        throw new WeavaError('这份内容已有另一项待执行的发布。', 409);
      return site.store.put(
        scope,
        id,
        {
          ...row.value,
          status: 'scheduled',
          dueAt: new Date(clock).toISOString(),
          error: undefined,
        },
        revision,
        '重试定时发布',
      );
    })
    .immediate();
}
function scheduleExecution(
  site: Site,
  row: NonNullable<ReturnType<Site['store']['get']>>,
  clock: number,
  jobId?: string,
): PublicationExecution {
  return {
    scope,
    row,
    options: { jobId },
    completedAt: () => new Date(clock).toISOString(),
    completeLabel: '定时发布完成',
    failureLabel: '定时发布失败',
    failureStatuses: ['scheduled'],
    guard: () => {
      const current = site.store.get(scope, row.id);
      if (
        current?.revision !== row.revision ||
        current.value.status !== 'scheduled' ||
        competingPublication(site, jobId)
      )
        throw new RetryablePublicationConflict('定时计划已变化，请等待下一次检查。');
    },
  };
}
function failSchedule(
  site: Site,
  row: NonNullable<ReturnType<Site['store']['get']>>,
  error: unknown,
) {
  failTrackedPublication(
    site,
    { scope, row, failureLabel: '定时发布失败', failureStatuses: ['scheduled'] },
    error,
  );
}
function dueSchedules(site: Site, clock: number) {
  return duePublications(site.store, [scope], clock, 20).map((row) =>
    site.store.get(scope, row.id)!,
  );
}
export function runSchedules(
  site: Site,
  clock = Date.now(),
  onlyId?: string,
  reviewRevision?: number | null,
  baseReleaseId?: string | null,
) {
  const completed: string[] = [],
    failed: string[] = [];
  for (const row of dueSchedules(site, clock).filter((row) => !onlyId || row.id === onlyId)) {
    if (competingPublication(site)) break;
    try {
      const prepared = preparePublication(site, {
        ids: [row.value.entryId],
        versions: { [row.value.entryId]: row.value.entryRevision },
        label: '定时发布',
      });
      if (
        reviewRevision !== undefined &&
        (reviewRevision !== prepared.reviewRevision ||
          baseReleaseId !== prepared.changes.baseReleaseId)
      )
        break;
      if (commitTrackedPublication(site, prepared, scheduleExecution(site, row, clock)))
        completed.push(row.id);
    } catch (error: any) {
      failSchedule(site, row, error);
      if (site.store.get(scope, row.id)?.value.status === 'failed') failed.push(row.id);
    }
  }
  return { completed, failed };
}
export async function runScheduledPublication(
  site: Site,
  id: string,
  revision: number,
  validate: (release: Release) => Promise<void>,
  clock = Date.now(),
  jobId?: string,
) {
  const row = site.store.get(scope, id);
  if (
    !row ||
    row.revision !== revision ||
    row.value.status !== 'scheduled' ||
    Date.parse(row.value.dueAt) > clock ||
    competingPublication(site, jobId)
  )
    return null;
  try {
    return await executeTrackedPublication(
      site,
      scheduleExecution(site, row, clock, jobId),
      () =>
        preparePublication(site, {
          ids: [row.value.entryId],
          versions: { [row.value.entryId]: row.value.entryRevision },
          label: '定时发布',
        }),
      validate,
    );
  } catch (error) {
    if (error instanceof RetryablePublicationConflict) return null;
    throw error;
  }
}
export async function runSchedulesAsync(
  site: Site,
  validate: (release: Release) => Promise<void>,
  clock = Date.now(),
) {
  await runPublicationPlans(site, validate, clock);
  const completed: string[] = [],
    failed: string[] = [];
  for (const row of dueSchedules(site, clock)) {
    if (competingPublication(site)) break;
    try {
      if (await runScheduledPublication(site, row.id, row.revision, validate, clock))
        completed.push(row.id);
    } catch {
      failed.push(row.id);
    }
  }
  return { completed, failed };
}
/** The live site's timer only selects and queues work. Preparation runs in the managed worker. */
export function queueScheduledPublications(
  site: Site,
  jobs: Pick<JobRunner, 'enqueue'>,
  clock = Date.now(),
) {
  if (competingPublication(site)) return;
  const [row] = duePublications(site.store, ['publication-schedule', 'publication-plan'], clock, 1);
  if (!row) return;
  jobs.enqueue(
    'publish',
    row.scope === 'publication-plan'
      ? { planId: row.id, planRevision: row.revision }
      : { scheduleId: row.id, scheduleRevision: row.revision },
  );
}
