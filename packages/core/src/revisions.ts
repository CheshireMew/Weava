import { entrySchema, WeavaError, type Entry } from '@weava/contracts';
import type { Site } from './site.ts';
import { renderDocument } from './documents.ts';

const plainObject = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : plainObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
}
const equal = (a: any, b: any) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const pointer = (parent: string, key: string) => parent + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
function editable(value: Entry) {
  const { updatedAt, ...rest } = entrySchema.parse(value);
  return rest;
}
export function entryRevision(site: Site, id: string, version: number) {
  const row = site.store.raw.prepare("SELECT data,created_at,label FROM revisions WHERE scope='entry' AND id=? AND revision=?").get(id, version) as any;
  if (!row) throw new WeavaError('版本不存在。', 404);
  return { id, revision: version, value: entrySchema.parse(JSON.parse(row.data)), createdAt: row.created_at, label: row.label };
}
export interface EntryChange { path: string; before: any; after: any; beforeHtml?: string; afterHtml?: string }
function documentPreview(path: string, before: any, after: any) {
  return path === '/document' ? { beforeHtml: renderDocument(before), afterHtml: renderDocument(after) } : {};
}
export function entryChanges(before: Entry, after: Entry): EntryChange[] {
  const changes: EntryChange[] = [];
  const visit = (a: any, b: any, path: string) => {
    if (equal(a, b)) return;
    if (path !== '/document' && plainObject(a) && plainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], pointer(path, key));
    } else changes.push({ path, before: a, after: b, ...documentPreview(path, a, b) });
  };
  visit(editable(before), editable(after), '');
  return changes;
}
export function mergeEntry(site: Site, id: string, baseRevision: number, value: Entry, choices: Record<string, 'local' | 'remote'> = {}) {
  const base = entryRevision(site, id, baseRevision);
  const remote = site.store.get('entry', id);
  if (!remote) throw new WeavaError('内容不存在。', 404);
  const local = entrySchema.parse(value);
  if (local.id !== id) throw new WeavaError('内容编号与合并目标不一致。');
  const conflicts: { path: string; base: any; local: any; remote: any; localHtml?: string; remoteHtml?: string }[] = [];
  const visit = (a: any, l: any, r: any, path: string): any => {
    if (equal(l, r)) return l;
    if (equal(a, l)) return r;
    if (equal(a, r)) return l;
    if (path !== '/document' && plainObject(l) && plainObject(r) && (plainObject(a) || a === undefined)) {
      const merged: Record<string, any> = {};
      for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(l), ...Object.keys(r)])) {
        const next = visit(a?.[key], l[key], r[key], pointer(path, key));
        if (next !== undefined) merged[key] = next;
      }
      return merged;
    }
    conflicts.push({ path, base: a, local: l, remote: r, ...(path === '/document' ? { localHtml: renderDocument(l), remoteHtml: renderDocument(r) } : {}) });
    return choices[path] === 'local' ? l : r;
  };
  const merged = entrySchema.parse(visit(editable(base.value), editable(local), editable(remote.value), ''));
  return { id, base, local, remote, merged, conflicts, changes: entryChanges(remote.value, merged) };
}
export function saveMergedEntry(site: Site, input: { id: string; baseRevision: number; currentRevision: number; value: Entry; choices?: Record<string, 'local' | 'remote'> }) {
  return site.store.raw.transaction(() => {
    const plan = mergeEntry(site, input.id, input.baseRevision, input.value, input.choices);
    if (plan.remote.revision !== input.currentRevision) throw new WeavaError('服务器内容再次变化，请重新比较。', 409);
    if (plan.conflicts.some((conflict) => !['local', 'remote'].includes(input.choices?.[conflict.path] ?? '')))
      throw new WeavaError('请为每处冲突选择保留内容。', 409);
    return site.saveEntry(plan.merged, plan.remote.revision);
  }).immediate();
}
