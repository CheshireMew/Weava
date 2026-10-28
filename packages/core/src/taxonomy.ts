import type { Site } from './site.ts';
import { WeavaError, type Entry, type Term } from '@weava/contracts';
import { digest } from './storage.ts';
import type { Block } from '@weava/contracts';
export function bindBlockTerms(blocks: Block[], catalog: Term[]): Block[] {
  return blocks.map((block) => {
    const props = { ...block.props };
    if (['content-list', 'cards'].includes(block.type)) for (const [key, kind] of [['category', 'category'], ['tag', 'tag']] as const) {
      const term = catalog.find((term) => term.kind === kind && (term.id === props[key] || term.label === props[key]));
      if (term) props[key] = term.id;
    }
    return { ...block, props, ...(block.children ? { children: bindBlockTerms(block.children, catalog) } : {}) };
  });
}

export function saveTerm(site: Site, input: Term, revision: number | null) {
  const term = { ...input, label: input.label.trim(), slug: input.slug.trim() };
  if (!term.id || !['category', 'tag'].includes(term.kind) || !term.label || !term.slug || /[/?#\\]/.test(term.slug))
    throw new WeavaError('分类或标签的名称、标识或网址无效。');
  const catalog = site.store.list('term');
  if (catalog.some((row) => row.id !== term.id && row.value.kind === term.kind && (row.value.slug === term.slug || (row.value.label === term.label && row.value.parentId === term.parentId))))
    throw new WeavaError('同类分类的名称或网址已存在。', 409);
  let parent = term.parentId;
  const seen = new Set([term.id]);
  while (parent) {
    if (seen.has(parent)) throw new WeavaError('分类不能形成循环层级。');
    seen.add(parent);
    const row = catalog.find((row) => row.id === parent);
    if (!row || row.value.kind !== term.kind) throw new WeavaError('上级分类不存在或种类不一致。');
    parent = row.value.parentId;
  }
  return site.store.put('term', term.id, term, revision);
}
export function ensureTerm(site: Site, label: string, kind: Term['kind'], preferredId?: string) {
  const existing = site.store.list('term').find((row) => row.value.kind === kind && row.value.label === label);
  if (existing) return existing.value as Term;
  const id = preferredId && !site.store.get('term', preferredId) ? preferredId : kind + '-' + digest(label).slice(0, 16);
  const term: Term = { id, kind, label, slug: label.trim().replace(/\s+/g, '-').replace(/[/?#\\]/g, '-') || id };
  if (site.store.list('term').some((row) => row.value.kind === kind && row.value.slug === term.slug)) term.slug += '-' + digest(label).slice(0, 6);
  return saveTerm(site, term, null).value as Term;
}
export function attachTerms(site: Site, entry: Entry, previous?: Entry): Entry {
  const catalog = site.store.list('term').map((row) => row.value as Term);
  const result = { ...entry, termIds: { categories: [] as string[], tags: [] as string[] } };
  for (const key of ['categories', 'tags'] as const) {
    // Editing a legacy label input is an explicit reassignment; otherwise IDs survive renaming.
    const labelsChanged = previous && JSON.stringify(previous[key]) !== JSON.stringify(entry[key]);
    const supplied = entry.termIds?.[key];
    const explicitIds = supplied && JSON.stringify(supplied.map((id) => catalog.find((term) => term.id === id)?.label)) === JSON.stringify(entry[key]);
    const ids = !labelsChanged || explicitIds ? supplied : undefined;
    if (ids) {
      const terms = ids.map((id) => catalog.find((term) => term.id === id && term.kind === (key === 'categories' ? 'category' : 'tag')));
      if (terms.some((term) => !term)) throw new WeavaError('关联的分类或标签不存在。');
      result.termIds[key] = [...new Set(ids)];
      result[key] = terms.map((term) => term!.label);
    } else {
      const terms = [...new Set(entry[key])].map((label) => ensureTerm(site, label, key === 'categories' ? 'category' : 'tag'));
      result.termIds[key] = terms.map((term) => term.id);
      result[key] = terms.map((term) => term.label);
    }
  }
  return { ...result, blocks: bindBlockTerms(result.blocks, site.terms().map((row) => row.value)) };
}
export function projectTerms<T extends Entry>(entry: T, catalog: Term[]): T {
  const labels = (key: 'categories' | 'tags') => entry.termIds?.[key]
    ? entry.termIds[key].map((id) => catalog.find((term) => term.id === id)?.label).filter((label): label is string => !!label) : entry[key];
  return { ...entry, categories: labels('categories'), tags: labels('tags') };
}
