import { WeavaError, type Entry } from '@weava/contracts';
import type { Site } from './site.ts';
import { digest } from './storage.ts';
import { prepareEntryCandidate } from './content-validation.ts';

export interface MetadataChange { field: string; mode: 'replace' | 'append' | 'clear'; value?: unknown }
export interface BulkEditInput { items: { id: string; revision: number }[]; changes: MetadataChange[]; review?: string }
export function previewBulkEdit(site: Site, input: BulkEditInput) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 200 || new Set(input.items.map((item) => item.id)).size !== input.items.length) throw new WeavaError('请选择 1～200 项不同内容。');
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 30) throw new WeavaError('请填写批量修改内容。');
  const rows = input.items.map((item) => {
    const row = site.store.get('entry', item.id);
    if (!row || row.revision !== item.revision) throw new WeavaError('所选内容已变化，请重新选择。', 409, { id: item.id });
    return row;
  });
  const candidates: Entry[] = rows.map((row) => {
    const value: Entry = structuredClone(row.value);
    for (const change of input.changes) {
      if (!['replace', 'append', 'clear'].includes(change.mode)) throw new WeavaError('批量操作方式无效。');
      const definition = site.store.get('type', value.type)?.value;
      const custom = change.field.startsWith('fields.') ? definition?.fields.find((field: any) => field.key === change.field.slice(7)) : null;
      if (!['author', 'visibility', 'indexable', 'categories', 'tags'].includes(change.field) && !custom) throw new WeavaError('批量修改字段不存在：' + change.field);
      const taxonomy = change.field === 'categories' || change.field === 'tags';
      const multiple = taxonomy || custom?.multiple;
      if (change.mode === 'append' && !multiple) throw new WeavaError('追加只用于分类、标签或重复字段。');
      if (change.mode === 'clear' && ['visibility', 'indexable'].includes(change.field)) throw new WeavaError('可见性和收录选项需要明确设置。');
      const key = custom ? change.field.slice(7) : change.field;
      const target: Record<string, any> = custom ? value.fields : value;
      if (taxonomy) {
        const kind = key === 'categories' ? 'category' : 'tag';
        const ids = change.mode === 'clear' ? [] : change.value;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || site.store.get('term', id)?.value.kind !== kind)) throw new WeavaError('分类或标签需要选择有效编号。');
        const previous = value.termIds?.[key as 'categories' | 'tags'] ?? [];
        const next = [...new Set(change.mode === 'append' ? [...previous, ...ids] : ids)];
        value.termIds = { categories: value.termIds?.categories ?? [], tags: value.termIds?.tags ?? [], [key]: next };
        target[key] = next.map((id) => site.store.get('term', id)!.value.label);
      } else if (change.mode === 'clear') target[key] = custom?.multiple ? [] : custom?.type === 'group' ? {} : custom?.type === 'number' || custom?.type === 'boolean' ? null : '';
      else if (change.mode === 'append') {
        if (!Array.isArray(change.value)) throw new WeavaError('追加内容需要是列表。');
        target[key] = [...new Map([...(target[key] ?? []), ...change.value].map((item) => [JSON.stringify(item), item])).values()];
      } else target[key] = structuredClone(change.value);
    }
    return value;
  });
  const values = candidates.map((value) => prepareEntryCandidate(site, value, { required: false, references: candidates }));
  const review = digest({ items: input.items, changes: input.changes, values });
  return { review, items: rows.map((row, index) => ({ id: row.id, title: row.value.title, revision: row.revision, before: row.value, after: values[index] })), values };
}
export function applyBulkEdit(site: Site, input: BulkEditInput) {
  return site.store.raw.transaction(() => {
    const preview = previewBulkEdit(site, input);
    if (!input.review || preview.review !== input.review) throw new WeavaError('批量修改预检已变化，请重新检查。', 409);
    return preview.values.map((value, index) => site.saveEntry(value, input.items[index].revision, { references: preview.values }));
  }).immediate();
}
