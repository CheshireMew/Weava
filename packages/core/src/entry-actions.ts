import { cloneBlocks, entrySchema, WeavaError, type PublishOptions } from '@weava/contracts';
import type { EntryRepository } from './entry-repository.ts';
import type { SiteContent } from './site-content.ts';
import type { SiteReleases } from './site-releases.ts';
import type { JobStore } from './job-store.ts';
interface EntryActionsSite {
  entryStore: EntryRepository;
  saveEntry: SiteContent['saveEntry'];
  withdraw: SiteReleases['withdraw'];
  activeJobs: JobStore['activeJobs'];
}

import { now, uuid } from '../../runtime-common/src/identity.ts';

function currentEntry(site: EntryActionsSite, id: string, revision: number) {
  const row = site.entryStore.get(id);
  if (!row) throw new WeavaError('内容不存在。', 404);
  if (row.revision !== revision) throw new WeavaError('内容已变化，请刷新列表后重试。', 409);
  return row;
}

export function duplicateContent(site: EntryActionsSite, id: string, revision: number) {
  return site.entryStore.transaction(() => {
    const original = currentEntry(site, id, revision).value;
    const nextId = uuid();
    const prefix =
      original.kind === 'page' ? '/' : site.entryStore.type(original.type)?.value.pathPrefix;
    if (!prefix) throw new WeavaError('内容类型不存在。');
    const value = entrySchema.parse({
      ...structuredClone(original),
      id: nextId,
      title: original.title.slice(0, 296) + '（副本）',
      path: prefix + nextId + '/',
      status: 'draft',
      createdAt: now(),
      updatedAt: undefined,
      publishedAt: undefined,
      source: undefined,
      seo: original.seo ? { ...original.seo, canonical: undefined } : undefined,
      blocks: cloneBlocks(original.blocks),
    });
    return site.saveEntry(value, null);
  });
}

export function deleteContent(
  site: EntryActionsSite,
  id: string,
  revision: number,
  reviewed?: PublishOptions | null,
) {
  return site.entryStore.transaction(() => {
    const original = structuredClone(currentEntry(site, id, revision).value);
    if (site.activeJobs().some((job) => job.operation === 'publish'))
      throw new WeavaError('发布任务正在执行，请等待完成后再删除。', 409);
    const scheduled = site.entryStore.scheduled(id);
    if (scheduled) throw new WeavaError('请先取消这篇内容的定时发布，再删除。', 409);
    const planned = site.entryStore.planned(id);
    if (planned) throw new WeavaError('这篇内容仍在发布计划中，请先从计划移除，再删除。', 409);
    // Withdraw through the normal publication checks; retain historical snapshots and shared media.
    site.withdraw(id, revision, true, reviewed);
    site.entryStore.moveToTrash(id, original, revision, now());
    return { id };
  });
}

export const trashedContent = (
  site: { entryStore: Pick<EntryRepository, 'trashed'> },
  input: Parameters<EntryRepository['trashed']>[0] = {},
) => site.entryStore.trashed(input);
function trashRecord(site: EntryActionsSite, id: string, revision: number) {
  const row = site.entryStore.trashRecord(id);
  if (!row) throw new WeavaError('回收站内容不存在。', 404);
  if (row.revision !== revision) throw new WeavaError('回收站内容已变化，请重新读取。', 409);
  return row;
}
export function restoreTrashedContent(site: EntryActionsSite, id: string, revision: number) {
  return site.entryStore.transaction(() => {
    const row = trashRecord(site, id, revision);
    if (site.entryStore.get(id)) throw new WeavaError('相同编号的内容已存在，未覆盖。', 409);
    const value = entrySchema.parse({
      ...row.value.entry,
      status: 'draft',
      publishedAt: undefined,
    });
    const restored = site.saveEntry(value, null);
    site.entryStore.removeTrash(id);
    return restored;
  });
}
/** Immutable publication history follows the separate history retention policy. */
export function purgeTrashedContent(
  site: EntryActionsSite,
  id: string,
  revision: number,
  confirmation: string,
) {
  if (confirmation !== '永久删除') throw new WeavaError('请明确输入“永久删除”。');
  return site.entryStore.transaction(() => {
    trashRecord(site, id, revision);
    site.entryStore.removeTrash(id);
    return { id };
  });
}
