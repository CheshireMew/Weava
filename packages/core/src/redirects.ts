import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { digest } from './storage.ts';
import { normalizePath } from './site.ts';
export interface RedirectEdit { source: string; target: string; entryId?: string; disabled?: boolean; revision: number | null }
export function redirectRecords(site: Site) {
  const saved = new Map(site.store.list('redirect').map((row) => [row.id, row]));
  for (const [id, value] of Object.entries(site.release()?.redirects ?? {})) if (!saved.has(id)) saved.set(id, { id, value, revision: null as any, updatedAt: '' });
  return [...saved.values()];
}
function normalized(value: string, source = false) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\r\n\\]/.test(value)) throw new WeavaError('网址别名只接受站内路径。');
  const url = new URL(value, 'https://weava.invalid');
  if (url.hash || !source && url.search || source && url.search && (url.pathname !== '/' || !/^\?(p|page_id)=\d+$/.test(url.search))) throw new WeavaError('来源仅支持路径或原 WordPress 编号，目标请使用站内路径。');
  return normalizePath(url.pathname) + url.search;
}
export function previewRedirects(site: Site, input: { items: RedirectEdit[] }) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) throw new WeavaError('每次请提交 1～500 条别名。');
  const records = new Map(redirectRecords(site).map((row) => [row.id, row.value]));
  const seen = new Set<string>();
  const items = input.items.map((item) => {
    const source = normalized(item.source, true), target = normalized(item.target);
    if (seen.has(source)) throw new WeavaError('来源网址重复：' + source); seen.add(source);
    const current = site.store.get('redirect', source);
    if ((current?.revision ?? null) !== item.revision) throw new WeavaError('别名已变化，请重新载入。', 409);
    const value = { target, ...(item.entryId ? { entryId: item.entryId } : {}), ...(item.disabled ? { disabled: true } : {}) };
    records.set(source, value); return { ...item, source, target, value };
  });
  const release = site.release(), paths = new Set(release?.entries.map((entry) => entry.path) ?? []);
  // Imported aliases may refer to working drafts. They are dormant until those
  // entries are public; an unrelated edit must not require publishing them.
  for (const [source, value] of records) if (value.entryId) {
    const target = release?.entries.find((entry) => entry.id === value.entryId);
    if (target) records.set(source, { ...value, target: target.path });
    else if (!seen.has(source)) records.delete(source);
  }
  for (const [source, value] of records) {
    if (value.disabled) continue;
    if (paths.has(source)) throw new WeavaError('来源网址已被公开内容使用：' + source);
    const visited = new Set([source]); let target = value.target;
    if (value.entryId && !release?.entries.some((entry) => entry.id === value.entryId)) throw new WeavaError('目标内容尚未发布。');
    while (!paths.has(target) && records.has(target) && !records.get(target).disabled) {
      if (visited.has(target)) throw new WeavaError('网址跳转形成循环：' + source);
      visited.add(target); target = records.get(target).target;
    }
    if (visited.has(target)) throw new WeavaError('网址跳转形成循环：' + source);
    if (!paths.has(target)) throw new WeavaError('别名目标未对应公开页面：' + target);
  }
  return { items, review: digest({ items, release: release?.id }) };
}
export function saveRedirects(site: Site, input: { items: RedirectEdit[]; review: string }) {
  return site.store.raw.transaction(() => {
    const preview = previewRedirects(site, input);
    if (!input.review || preview.review !== input.review) throw new WeavaError('别名预检已变化，请重新检查。', 409);
    return preview.items.map((item) => site.store.put('redirect', item.source, item.value, item.revision));
  }).immediate();
}
