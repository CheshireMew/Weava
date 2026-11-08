import { WeavaError, type Term } from '@weava/contracts';
import { digest } from '../../runtime-common/src/identity.ts';
import { children, text, titleText, type Item, type Xml } from './wordpress-wxr-xml.ts';
export function wxrTerms(
  channel: Xml,
  content: Item[],
  namespace: string,
  existingTerms: Term[],
  warnings: string[],
) {
  const termMap = new Map<string, Term>(),
    parentSlugs = new Map<string, string>();
  for (const [name, kind, slugKey, labelKey, parentKey] of [
    ['wp:category', 'category', 'wp:category_nicename', 'wp:cat_name', 'wp:category_parent'],
    ['wp:tag', 'tag', 'wp:tag_slug', 'wp:tag_name', ''],
  ] as const)
    for (const node of children(channel, name)) {
      const slug = text(node, slugKey),
        key = kind + ':' + slug;
      if (!slug || termMap.has(key)) throw new WeavaError('WXR 分类网址缺失或重复：' + key);
      termMap.set(key, {
        id:
          'wpterm:' +
          namespace +
          ':' +
          kind +
          ':' +
          (text(node, 'wp:term_id') || digest(slug).slice(0, 12)),
        kind,
        label: titleText(text(node, labelKey)) || slug,
        slug,
      });
      if (parentKey && text(node, parentKey)) parentSlugs.set(key, text(node, parentKey));
    }
  for (const item of content)
    for (const tax of item.taxonomies) {
      const kind = tax.kind === 'post_tag' ? 'tag' : tax.kind;
      if (!['category', 'tag'].includes(kind)) continue;
      const key = kind + ':' + tax.slug;
      if (!termMap.has(key))
        termMap.set(key, {
          id: 'wpterm:' + namespace + ':' + digest(key).slice(0, 12),
          kind: kind as Term['kind'],
          label: tax.label || tax.slug,
          slug: tax.slug || 'term-' + digest(tax.label).slice(0, 10),
        });
    }
  for (const [key, parentSlug] of parentSlugs) {
    const parent = termMap.get('category:' + parentSlug);
    if (!parent) throw new WeavaError('WordPress 上级分类未包含在文件中：' + parentSlug);
    termMap.get(key)!.parentId = parent.id;
  }
  const termIds = new Map<string, string>();
  const pendingTerms = [...termMap],
    sourceTermIds = new Set(pendingTerms.map(([, term]) => term.id));
  while (pendingTerms.length) {
    const index = pendingTerms.findIndex(
      ([, term]) =>
        !term.parentId || !sourceTermIds.has(term.parentId) || termIds.has(term.parentId),
    );
    if (index < 0) throw new WeavaError('WordPress 分类存在循环层级。');
    const [key, original] = pendingTerms.splice(index, 1)[0];
    const term = {
      ...original,
      ...(original.parentId
        ? { parentId: termIds.get(original.parentId) ?? original.parentId }
        : {}),
    };
    if (!existingTerms.some((item) => item.id === term.id)) {
      const sameSlug = existingTerms.find(
        (item) => item.kind === term.kind && item.slug === term.slug,
      );
      const sameLabel = existingTerms.find(
        (item) =>
          item.kind === term.kind && item.label === term.label && item.parentId === term.parentId,
      );
      if (sameSlug) term.id = sameSlug.id;
      else if (sameLabel) {
        term.id = sameLabel.id;
        term.slug = sameLabel.slug;
        warnings.push('分类“' + term.label + '”已关联现有同级分类，保留其网址 ' + term.slug + '。');
      }
    }
    termIds.set(original.id, term.id);
    termMap.set(key, term);
  }
  return termMap;
}
