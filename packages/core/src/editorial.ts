import { WeavaError, type Block, type Entry, type PublishedEntry, type Release } from '@weava/contracts';
import { escape as e, plain, renderDocument } from './documents.ts';
import { selectEntries } from './query.ts';
import { releaseIndex, entryLabels, newestFirst } from './release-index.ts';
const summaryText = (html: string) => plain(html.replace(/<button\b[^>]*\bdata-copy-code\b[^>]*>.*?<\/button>/gs, ''));

export function entrySummary(entry: Entry, html?: string, renderPrefix?: (blocks: Block[]) => string) {
  if (entry.summaryMode === undefined || entry.summaryMode === 'manual') return entry.description;
  if (entry.description.trim()) return entry.description;
  if (entry.summaryMode === 'marker') {
    if (entry.blocks.length) {
      let found = false;
      const prefix = (blocks: Block[]): Block[] => {
        const result: Block[] = [];
        for (const block of blocks) {
          if (found) break;
          const copy = structuredClone(block);
          if (['richtext', 'text'].includes(copy.type) && typeof copy.props.text === 'string') {
            const index = copy.props.text.search(/<!--\s*more\s*-->/i);
            if (index >= 0) { copy.props.text = copy.props.text.slice(0, index); found = true; }
          }
          if (!found && copy.children) copy.children = prefix(copy.children);
          result.push(copy);
        }
        return result;
      };
      const blocks = prefix(entry.blocks);
      if (!found) return '';
      const plainPrefix = (items: Block[]): string => items.map((block) => renderDocument({ version: 1, format: 'markdown', source: [block.props.title, block.props.text].filter((value) => typeof value === 'string').join('\n') }) + plainPrefix(block.children ?? [])).join(' ');
      return summaryText(renderPrefix ? renderPrefix(blocks) : plainPrefix(blocks));
    }
    const source = entry.document.format === 'markdown' || entry.document.format === 'html' ? entry.document.source : '';
    const index = source.search(/<!--\s*more\s*-->/i);
    return index >= 0 ? summaryText(renderDocument({ ...entry.document, source: source.slice(0, index) } as Entry['document'])) : '';
  }
  return [...summaryText(html ?? renderDocument(entry.document))].slice(0, 180).join('');
}
export function recommendedEntries(entry: Entry, release: Release, limit = 6) {
  const take = Math.max(0, limit), index = releaseIndex(release);
  if (!take) return [];
  const eligible = (item: PublishedEntry | undefined): item is PublishedEntry => !!item && item.id !== entry.id && item.kind === 'content' && item.visibility !== 'private' && item.indexable;
  const manual = [...new Set(entry.editorial?.relatedIds ?? [])].map(id => index.byId.get(id)).filter(eligible);
  const chosen = new Set(manual.map(item => item.id)), own = new Set(entryLabels(entry));
  const self = index.byId.get(entry.id);
  const count = index.recommendable.length - Number(!!self && self.kind === 'content' && self.visibility !== 'private' && self.indexable);
  const scores = new Map<PublishedEntry, number>();
  for (const label of own) {
    const matching = index.byLabel.get(label) ?? [];
    const frequency = matching.length - Number(matching.some(item => item.id === entry.id));
    const weight = (label.startsWith('tag:') ? 3 : 1.5) * Math.log(1 + count / (frequency || 1));
    for (const item of matching) if (item.id !== entry.id && !chosen.has(item.id)) {
      const repeats = entryLabels(item).filter(value => value === label).length;
      scores.set(item, (scores.get(item) ?? 0) + weight * repeats);
    }
  }
  const ranked = [...scores].sort(([a, av], [b, bv]) => bv - av || newestFirst(a, b)).map(([item]) => item);
  const selected = [...manual, ...ranked].slice(0, take);
  for (const item of selected) chosen.add(item.id);
  for (const item of index.recommendable) {
    if (selected.length >= take) break;
    if (item.id !== entry.id && !chosen.has(item.id)) { selected.push(item); chosen.add(item.id); }
  }
  return selected;
}
export function featuredEntries(entries: PublishedEntry[]) {
  return [...entries].sort((a, b) => Number(!!b.editorial?.featured) - Number(!!a.editorial?.featured) || (b.editorial?.weight ?? 0) - (a.editorial?.weight ?? 0) || String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id));
}
export function documentNavigation(entry: Entry, release: Release) {
  if (!entry.documentation) return null;
  const items = release.entries.filter((item) => item.documentation?.group === entry.documentation!.group && (entry.visibility === 'private' || item.visibility !== 'private'));
  const map = new Map(items.map((item) => [item.id, item]));
  const ordered: PublishedEntry[] = [];
  const children = (parentId?: string) => items.filter((item) => (map.has(item.documentation?.parentId ?? '') ? item.documentation?.parentId : undefined) === parentId).sort((a, b) => (a.documentation?.order ?? 0) - (b.documentation?.order ?? 0) || a.title.localeCompare(b.title));
  const walk = (parentId?: string, depth = 0) => { if (depth > items.length) throw new WeavaError('文档导航存在循环。'); for (const item of children(parentId)) { ordered.push(item); walk(item.id, depth + 1); } };
  walk();
  const breadcrumbs: PublishedEntry[] = [], seen = new Set<string>([entry.id]); let parent = map.get(entry.documentation.parentId ?? '');
  while (parent) { if (seen.has(parent.id)) throw new WeavaError('文档导航存在循环。'); seen.add(parent.id); breadcrumbs.unshift(parent); parent = map.get(parent.documentation?.parentId ?? ''); }
  const index = ordered.findIndex((item) => item.id === entry.id);
  return { items: ordered, breadcrumbs, previous: index > 0 ? ordered[index - 1] : null, next: index >= 0 ? ordered[index + 1] ?? null : null };
}
export function validateEditorial(release: Release) {
  for (const entry of release.entries) {
    for (const id of entry.editorial?.relatedIds ?? []) if (id === entry.id || !release.entries.some((target) => target.id === id && target.kind === 'content' && (entry.visibility === 'private' || target.visibility !== 'private'))) throw new WeavaError('推荐内容不存在、不可公开或引用自身：' + entry.title);
    const parentId = entry.documentation?.parentId;
    if (parentId && !release.entries.some((target) => target.id === parentId && target.documentation?.group === entry.documentation?.group && (entry.visibility === 'private' || target.visibility !== 'private'))) throw new WeavaError('文档上级需要属于同一分组且可访问：' + entry.title);
    documentNavigation(entry, release);
  }
}
export function renderDocumentNavigation(entry: Entry, release: Release) {
  const nav = documentNavigation(entry, release); if (!nav) return { before: '', after: '' };
  const link = (item: Entry, rel = '') => `<a href="${e(item.path)}"${rel ? ` rel="${rel}"` : ''}>${e(item.title)}</a>`;
  const depth = (item: Entry) => { let value = 0, parent = item.documentation?.parentId; while (parent && value < nav.items.length) { const target = nav.items.find((candidate) => candidate.id === parent); if (!target) break; value++; parent = target.documentation?.parentId; } return value; };
  return { before: `<nav class="doc-breadcrumbs" aria-label="面包屑">${nav.breadcrumbs.map((item) => link(item)).join(' / ')}${nav.breadcrumbs.length ? ' / ' : ''}<span>${e(entry.title)}</span></nav><nav class="doc-navigation" aria-label="文档导航"><strong>${e(entry.documentation!.group)}</strong>${nav.items.map((item) => `<a href="${e(item.path)}" style="--doc-depth:${depth(item)}"${item.id === entry.id ? ' aria-current="page"' : ''}>${e(item.title)}</a>`).join('')}</nav>`, after: `<nav class="doc-pagination" aria-label="文档翻页">${nav.previous ? link(nav.previous, 'prev') : '<span></span>'}${nav.next ? link(nav.next, 'next') : ''}</nav>` };
}
export function scopedFeed(release: Release, params: URLSearchParams) {
  return selectEntries(release.entries.filter((item) => item.kind === 'content' && item.visibility !== 'private' && item.indexable), { type: params.get('type') || undefined, category: params.get('category') || undefined }, release.types, release.terms)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 30);
}
export function feedLinks(entry: Entry | undefined, release: Release) {
  const links = [{ title: '全部内容', url: '/rss.xml' }];
  if (entry?.kind === 'content') links.push({ title: release.types.find((type) => type.id === entry.type)?.label ?? entry.type, url: '/rss.xml?' + new URLSearchParams({ type: entry.type }) });
  for (const id of entry?.termIds?.categories ?? []) { const term = release.terms?.find((term) => term.id === id); if (term) links.push({ title: term.label, url: '/rss.xml?' + new URLSearchParams({ category: id }) }); }
  return links;
}
