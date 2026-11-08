import {
  publicationPlanInputSchema,
  WeavaError,
  z,
  type PublishOptions,
  type Release,
} from '@weava/contracts';
import { now } from '../../runtime-common/src/identity.ts';
import { equalJson } from '../../runtime-common/src/json.ts';
import { executeTrackedPublication, hasCompetingPublication } from './publication-execution.ts';
import { duePublications } from './publication-time.ts';
import {
  assertPublicationCurrent,
  preparePublication,
  readPublicationCandidate,
} from './publication.ts';
import type { Site } from './site.ts';
const definition = publicationPlanInputSchema;
export const publicationPlans = (site: Site) => site.store.list('publication-plan');
export function planOptions(site: Site, plan: z.infer<typeof definition>): PublishOptions {
  const ids: string[] = [],
    versions: Record<string, number> = {},
    withdrawIds: string[] = [],
    withdrawRevisions: Record<string, number> = {};
  const seen = new Set<string>();
  for (const action of plan.actions) {
    if (seen.has(action.id)) throw new WeavaError('计划中每份内容只能出现一次。');
    seen.add(action.id);
    if (action.action === 'publish') {
      ids.push(action.id);
      versions[action.id] = action.revision;
    } else {
      withdrawIds.push(action.id);
      withdrawRevisions[action.id] = action.revision;
    }
  }
  return { scope: 'entries', ids, versions, withdrawIds, withdrawRevisions, label: plan.name };
}
export function savePublicationPlan(
  site: Site,
  input: unknown,
  revision: number | null,
  clock = Date.now(),
) {
  const plan = definition.parse(input);
  if (plan.dueAt && (!Number.isFinite(Date.parse(plan.dueAt)) || Date.parse(plan.dueAt) <= clock))
    throw new WeavaError('计划执行时间需要晚于当前时间。');
  if (plan.dueAt) plan.dueAt = new Date(plan.dueAt).toISOString();
  const prepared = preparePublication(site, planOptions(site, plan));
  return site.store.raw
    .transaction(() => {
      assertPublicationCurrent(site, prepared);
      const current = site.store.get('publication-plan', plan.id);
      if (current && !['draft', 'scheduled', 'failed'].includes(current.value.status))
        throw new WeavaError('这个计划已完成或取消，请新建计划。');
      const review = prepared.changes;
      const actions = plan.actions.map((action) => ({
        ...action,
        title:
          [...review.entries, ...review.removed].find((entry) => entry.id === action.id)?.title ??
          site.release()?.entries.find((entry) => entry.id === action.id)?.title ??
          action.id,
      }));
      return site.store.put(
        'publication-plan',
        plan.id,
        {
          ...plan,
          actions,
          status: plan.dueAt ? 'scheduled' : 'draft',
          attempts: current?.value.attempts ?? 0,
          createdAt: current?.value.createdAt ?? now(),
        },
        revision,
        '保存发布计划',
      );
    })
    .immediate();
}
export function reviewPublicationPlan(site: Site, id: string, revision: number) {
  const row = requireRunnablePlan(site, id, revision);
  return { plan: row, review: site.previewPublication(planOptions(site, row.value)) };
}
export async function runPublicationPlan(
  site: Site,
  id: string,
  revision: number,
  validate: (release: Release) => Promise<void>,
  options?: PublishOptions,
  jobId?: string,
) {
  const row = requireRunnablePlan(site, id, revision);
  const expected = planOptions(site, row.value);
  if (options) {
    if (options.baseReleaseId !== (site.store.state('release') ?? null))
      throw new WeavaError('计划预检已变化，请重新检查。', 409);
    for (const key of [
      'scope',
      'ids',
      'versions',
      'withdrawIds',
      'withdrawRevisions',
      'label',
    ] as const)
      if (!equalJson(options[key], expected[key]))
        throw new WeavaError('计划预检已变化，请重新检查。', 409);
  }
  const release = await executeTrackedPublication(
    site,
    {
      scope: 'publication-plan',
      row,
      options: { ...options, jobId },
      completedAt: now,
      completeLabel: '发布计划完成',
      failureLabel: '发布计划失败',
      failureStatuses: ['draft', 'scheduled', 'failed'],
      guard: () => {
        if (site.store.get('publication-plan', id)?.revision !== revision)
          throw new WeavaError('计划已变化，请重新检查。', 409);
      },
    },
    () => (options ? readPublicationCandidate(site, options) : preparePublication(site, expected)),
    validate,
  );
  return { releaseId: release.id, entries: release.entries.length };
}
export function cancelPublicationPlan(site: Site, id: string, revision: number) {
  const row = site.store.get('publication-plan', id);
  if (
    !row ||
    row.revision !== revision ||
    !['draft', 'scheduled', 'failed'].includes(row.value.status)
  )
    throw new WeavaError('计划当前不能取消。', 409);
  return site.store.put(
    'publication-plan',
    id,
    { ...row.value, status: 'cancelled' },
    revision,
    '取消发布计划',
  );
}
export async function runPublicationPlans(
  site: Site,
  validate: (release: Release) => Promise<void>,
  clock = Date.now(),
) {
  const completed: string[] = [],
    failed: string[] = [];
  for (const row of duePublications(site.store, ['publication-plan'], clock, 20)) {
    if (hasCompetingPublication(site)) break;
    try {
      await runPublicationPlan(site, row.id, row.revision, validate);
      completed.push(row.id);
    } catch {
      failed.push(row.id);
    }
  }
  return { completed, failed };
}

export function publicationPlanEntry(site: Site, id: string) {
  const row = site.store.get('entry', id);
  if (!row) throw new WeavaError('内容不存在。', 404);
  return {
    id,
    title: row.value.title,
    revision: row.revision,
    publishedRevision: site.release()?.entries.find((entry) => entry.id === id)?.revisionId,
  };
}
export function requireRunnablePlan(site: Pick<Site, 'store'>, id: string, revision: number) {
  const row = site.store.get('publication-plan', id);
  if (
    !row ||
    row.revision !== revision ||
    !['draft', 'scheduled', 'failed'].includes(row.value.status)
  )
    throw new WeavaError('计划已变化，请重新载入。', 409);
  return row;
}
