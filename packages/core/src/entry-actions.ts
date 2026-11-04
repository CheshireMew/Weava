import { cloneBlocks, entrySchema, WeavaError, type PublishOptions } from '@weava/contracts';
import type { Site } from './site.ts';
import { now, uuid } from './storage.ts';

function currentEntry(site: Site, id: string, revision: number) {
  const row = site.store.get('entry', id);
  if (!row) throw new WeavaError('内容不存在。', 404);
  if (row.revision !== revision) throw new WeavaError('内容已变化，请刷新列表后重试。', 409);
  return row;
}

export function duplicateContent(site: Site, id: string, revision: number) {
  return site.store.raw.transaction(() => {
    const original = currentEntry(site, id, revision).value;
    const nextId = uuid();
    const prefix = original.kind === 'page' ? '/' : site.store.get('type', original.type)?.value.pathPrefix;
    if (!prefix) throw new WeavaError('内容类型不存在。');
    const value = entrySchema.parse({
      ...structuredClone(original), id: nextId,
      title: original.title.slice(0, 296) + '（副本）', path: prefix + nextId + '/',
      status: 'draft', createdAt: now(), updatedAt: undefined, publishedAt: undefined,
      source: undefined,
      seo: original.seo ? { ...original.seo, canonical: undefined } : undefined,
      blocks: cloneBlocks(original.blocks),
    });
    return site.saveEntry(value, null);
  }).immediate();
}

export function deleteContent(site: Site, id: string, revision: number, reviewed?: PublishOptions | null) {
  return site.store.raw.transaction(() => {
    currentEntry(site, id, revision);
    if (site.activeJobs().some(job => job.operation === 'publish'))
      throw new WeavaError('发布任务正在执行，请等待完成后再删除。', 409);
    const scheduled = site.store.raw.prepare("SELECT 1 FROM records WHERE scope='publication-schedule' AND json_extract(data,'$.entryId')=? AND json_extract(data,'$.status') IN ('scheduled','running','failed') LIMIT 1").get(id);
    if (scheduled) throw new WeavaError('请先取消这篇内容的定时发布，再删除。', 409);
    const planned = site.store.list('publication-plan').some(row => ['draft', 'scheduled', 'running', 'failed'].includes(row.value.status) && row.value.actions.some((action: { id: string }) => action.id === id));
    if (planned) throw new WeavaError('这篇内容仍在发布计划中，请先从计划移除，再删除。', 409);
    // Withdraw through the normal publication checks; retain historical snapshots and shared media.
    site.withdraw(id, revision, true, reviewed);
    site.store.raw.prepare("DELETE FROM records WHERE scope='entry' AND id=?").run(id);
    site.store.raw.prepare('DELETE FROM entry_list WHERE id=?').run(id);
    return { id };
  }).immediate();
}
