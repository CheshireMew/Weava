import { entrySchema, typeSchema, layoutSchema, WeavaError, type Settings, type Term, type Layout } from '@weava/contracts';
import { saveLayout } from './layouts.ts';
import type { Site } from './site.ts';
import { digest } from './storage.ts';

export interface SiteExchange {
  version: 1;
  settings?: Settings;
  types?: unknown[];
  entries?: unknown[];
  terms?: Term[];
  layouts?: Layout[];
  redirects?: Record<string, { target: string; entryId?: string }>;
}
export interface ImportOptions {
  mode?: 'create' | 'merge';
  dryRun?: boolean;
  revisions?: Record<string, number>;
}
export function exportSite(site: Site): SiteExchange {
  return { version: 1, settings: site.settings().value, types: site.store.list('type').map((row) => row.value),
    entries: site.store.list('entry').map((row) => row.value), terms: site.terms().map((row) => row.value), layouts: site.store.list('layout').map((row) => row.value),
    redirects: Object.fromEntries(site.store.list('redirect').map((row) => [row.id, row.value])) };
}
const comparable = (scope: string, value: any) => scope === 'entry' ? { ...value, updatedAt: undefined } : value;
function fingerprint(scope: string, value: any) {
  const canonical = (input: any): any => Array.isArray(input) ? input.map(canonical) :
    input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().filter((key) => input[key] !== undefined).map((key) => [key, canonical(input[key])])) : input;
  return digest(canonical(comparable(scope, value)));
}

export function importSite(site: Site, source: SiteExchange, options: ImportOptions = {}) {
  if (source?.version !== 1) throw new WeavaError('不支持这个站点交换格式版本。');
  if (options.mode && !['create', 'merge'].includes(options.mode)) throw new WeavaError('导入方式无效。');
  for (const key of ['entries', 'types', 'terms', 'layouts'] as const)
    if (source[key] !== undefined && !Array.isArray(source[key])) throw new WeavaError('导入的 ' + key + ' 需要是列表。');
  const types = (source.types ?? []).map((value) => typeSchema.parse(value));
  const entries = (source.entries ?? []).map((value) => entrySchema.parse(value));
  const layouts = (source.layouts ?? []).map((value) => layoutSchema.parse(value));
  const groups = [['type', types], ['entry', entries], ['term', source.terms ?? []], ['layout', layouts]] as const;
  const conflicts: { scope: string; id: string; revision: number; reason: string }[] = [];
  const empty = !site.store.list('entry').length && !site.release();
  const rows = new Map<string, ReturnType<Site['store']['get']>>();
  const changed = (scope: string, id: string, value: any) => {
    const key = scope + ':' + id, row = site.store.get(scope, id); rows.set(key, row);
    if (!row || fingerprint(scope, row.value) === fingerprint(scope, value)) return;
    if (options.mode === 'merge' && options.revisions?.[key] === row.revision) return;
    if (empty && ['type', 'settings'].includes(scope)) return;
    conflicts.push({ scope, id, revision: row.revision,
      reason: options.mode === 'merge' ? '更新需要匹配当前修订号。' : '已存在不同内容，请使用合并模式并提供修订号。' });
  };
  for (const [scope, values] of groups) {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.id)) throw new WeavaError('导入编号重复：' + scope + ':' + value.id);
      seen.add(value.id); changed(scope, value.id, value);
    }
  }
  if (source.redirects && (typeof source.redirects !== 'object' || Array.isArray(source.redirects))) throw new WeavaError('导入网址别名需要是对象。');
  for (const [id, value] of Object.entries(source.redirects ?? {})) {
    if (!id.startsWith('/') || !value || typeof value.target !== 'string' || !value.target.startsWith('/') || value.target.startsWith('//') || /[\r\n]/.test(id + value.target) || (value.entryId !== undefined && typeof value.entryId !== 'string')) throw new WeavaError('导入的网址别名无效：' + id);
    changed('redirect', id, value);
  }
  if (source.settings) changed('settings', 'site', source.settings);
  if (conflicts.length) throw new WeavaError('导入存在冲突，未写入任何内容。', 409, conflicts);
  const report = { dryRun: !!options.dryRun, created: [] as string[], updated: [] as string[], unchanged: [] as string[],
    imported: entries.length, published: false };
  const dryRun = new Error('rollback import preview');
  const save = (scope: string, id: string, value: any, write: (revision: number | null) => unknown) => {
    const key = scope + ':' + id, row = rows.get(key);
    if (row && fingerprint(scope, row.value) === fingerprint(scope, value)) { report.unchanged.push(key); return; }
    write(row?.revision ?? null);
    (row ? report.updated : report.created).push(key);
  };
  try {
    site.store.raw.transaction(() => {
      // Recheck revisions inside the write transaction; preflight must not authorize a later overwrite.
      for (const [key, row] of rows) {
        const split = key.indexOf(':'), current = site.store.get(key.slice(0, split), key.slice(split + 1));
        if ((current?.revision ?? null) !== (row?.revision ?? null)) throw new WeavaError('导入目标已变化，请重新预检。', 409);
      }
      // Resolve parents before their children, regardless of source file ordering.
      const pending = [...(source.terms ?? [])];
      while (pending.length) {
        const index = pending.findIndex((term) => !term.parentId || site.store.get('term', term.parentId));
        if (index < 0) throw new WeavaError('导入分类的上级不存在或存在循环。');
        const [term] = pending.splice(index, 1);
        save('term', term.id, term, (revision) => site.saveTerm(term, revision));
      }
      if (source.settings) save('settings', 'site', source.settings, (revision) => site.saveSettings(source.settings!, revision!));
      for (const type of types) save('type', type.id, type, (revision) => site.saveType(type, revision));
      const layoutQueue = [...layouts];
      while (layoutQueue.length) {
        const available = layoutQueue.findIndex((layout) => {
          const references = JSON.stringify(layout.blocks).matchAll(/"layoutId":"([^"]+)"/g);
          return [...references].every((match) => !!site.store.get('layout', match[1]));
        });
        if (available < 0) throw new WeavaError('导入布局存在缺失或循环的共享区域引用。');
        const [layout] = layoutQueue.splice(available, 1);
        save('layout', layout.id, layout, (revision) => saveLayout(site, layout, revision));
      }
      for (const entry of entries) save('entry', entry.id, entry, (revision) => site.saveEntry(entry, revision));
      for (const [id, value] of Object.entries(source.redirects ?? {})) save('redirect', id, value, (revision) => site.store.put('redirect', id, value, revision));
      if (options.dryRun) throw dryRun;
    }).immediate();
  } catch (error) { if (error !== dryRun) throw error; }
  return report;
}
