import { z, WeavaError, type PublishOptions, type Release } from '@weava/contracts';
import type { Site } from './site.ts';
import { now } from './storage.ts';
import { preparePublication } from './publication.ts';
const definition = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(120), dueAt: z.string().optional(), actions: z.array(z.object({ id: z.string().min(1), action: z.enum(['publish', 'withdraw']), revision: z.number().int().positive() })).min(1).max(200) });
export const publicationPlans = (site: Site) => site.store.list('publication-plan');
export function planOptions(site: Site, plan: z.infer<typeof definition>): PublishOptions {
  const ids: string[] = [], versions: Record<string, number> = {}, withdrawIds: string[] = [], withdrawRevisions: Record<string, number> = {};
  const seen = new Set<string>();
  for (const action of plan.actions) {
    if (seen.has(action.id)) throw new WeavaError('计划中每份内容只能出现一次。'); seen.add(action.id);
    if (action.action === 'publish') { ids.push(action.id); versions[action.id] = action.revision; }
    else { withdrawIds.push(action.id); withdrawRevisions[action.id] = action.revision; }
  }
  return { scope: 'entries', ids, versions, withdrawIds, withdrawRevisions, label: plan.name };
}
export function savePublicationPlan(site: Site, input: unknown, revision: number | null, clock = Date.now()) {
  const plan = definition.parse(input);
  if (plan.dueAt && (!Number.isFinite(Date.parse(plan.dueAt)) || Date.parse(plan.dueAt) <= clock)) throw new WeavaError('计划执行时间需要晚于当前时间。');
  return site.store.raw.transaction(() => {
    const current = site.store.get('publication-plan', plan.id);
    if (current && !['draft', 'scheduled', 'failed'].includes(current.value.status)) throw new WeavaError('这个计划已完成或取消，请新建计划。');
    const review = site.previewPublication(planOptions(site, plan));
    const actions = plan.actions.map((action) => ({ ...action, title: [...review.entries, ...review.removed].find((entry) => entry.id === action.id)?.title ?? site.release()?.entries.find((entry) => entry.id === action.id)?.title ?? action.id }));
    return site.store.put('publication-plan', plan.id, { ...plan, actions, status: plan.dueAt ? 'scheduled' : 'draft', attempts: current?.value.attempts ?? 0, createdAt: current?.value.createdAt ?? now() }, revision, '保存发布计划');
  }).immediate();
}
export function reviewPublicationPlan(site: Site, id: string, revision: number) {
  const row = site.store.get('publication-plan', id);
  if (!row || row.revision !== revision || !['draft', 'scheduled', 'failed'].includes(row.value.status)) throw new WeavaError('计划已变化，请重新载入。', 409);
  return { plan: row, review: site.previewPublication(planOptions(site, row.value)) };
}
export async function runPublicationPlan(site: Site, id: string, revision: number, validate: (release: Release) => Promise<void>, options?: PublishOptions, jobId?: string) {
  const checked = reviewPublicationPlan(site, id, revision);
  if (options && (options.baseReleaseId !== checked.review.options.baseReleaseId || options.reviewRevision !== checked.review.options.reviewRevision)) throw new WeavaError('计划预检已变化，请重新检查。', 409);
  try {
    const candidate = preparePublication(site, checked.review.options).release;
    await validate(candidate);
    return site.store.raw.transaction(() => {
      const current = site.store.get('publication-plan', id);
      if (current?.revision !== revision) throw new WeavaError('计划已变化，请重新检查。', 409);
      const release = site.publish({ ...checked.review.options, jobId });
      site.store.put('publication-plan', id, { ...current.value, status: 'complete', attempts: current.value.attempts + 1, releaseId: release.id, completedAt: now(), error: undefined }, current.revision, '发布计划完成');
      return { releaseId: release.id, entries: release.entries.length };
    }).immediate();
  } catch (error: any) {
    const current = site.store.get('publication-plan', id);
    if (current?.revision === revision) site.store.put('publication-plan', id, { ...current.value, status: 'failed', attempts: current.value.attempts + 1, error: error.message }, revision, '发布计划失败');
    throw error;
  }
}
export function cancelPublicationPlan(site: Site, id: string, revision: number) {
  const row = site.store.get('publication-plan', id);
  if (!row || row.revision !== revision || !['draft','scheduled','failed'].includes(row.value.status)) throw new WeavaError('计划当前不能取消。', 409);
  return site.store.put('publication-plan', id, { ...row.value, status: 'cancelled' }, revision, '取消发布计划');
}
export async function runPublicationPlans(site: Site, validate: (release: Release) => Promise<void>, clock = Date.now()) {
  const completed: string[] = [], failed: string[] = [];
  for (const row of publicationPlans(site).filter((row) => row.value.status === 'scheduled' && Date.parse(row.value.dueAt) <= clock).slice(0, 20)) {
    if (site.store.raw.prepare("SELECT 1 FROM jobs WHERE operation='publish' AND status IN ('queued','running')").get()) break;
    try { await runPublicationPlan(site, row.id, row.revision, validate); completed.push(row.id); }
    catch { failed.push(row.id); }
  }
  return { completed, failed };
}
