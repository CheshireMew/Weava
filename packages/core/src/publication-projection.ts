import {
  WeavaError,
  entrySchema,
  isReservedContentPath,
  type PublishOptions,
  type PublishedEntry,
  type Release,
  type Term,
} from '@weava/contracts';
import { digest } from '../../runtime-common/src/identity.ts';
import { renderDocument } from './documents.ts';
import { builtInLayouts, visitBlocks } from './layouts.ts';
import { normalizePath } from './paths.ts';
import type { PublicationSite } from './publication-context.ts';
import type { PublicationSnapshot } from './publication-snapshot.ts';
import { immutableDigest } from './publication-validation.ts';
import { publishedHasBlocks } from './release-reader.ts';
import { applySiteInfo } from './site-info.ts';
import { publicationModifiedAt } from './source-content.ts';
import { bindBlockTerms, projectTerms } from './taxonomy.ts';

export function projectPublicationEntries(
  context: PublicationSnapshot,
  options: PublishOptions,
  time: string,
) {
  const { previous, snapshot, scope, selected, settings } = context;
  const entries = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  if (!['settings', 'layouts', 'terms', 'routes'].includes(scope))
    for (const row of snapshot.drafts) {
      if (selected && !selected.has(row.id)) continue;
      const entry = entrySchema.parse(row.value);
      if (entry.status === 'archived') {
        entries.delete(entry.id);
        continue;
      }
      if (entry.status === 'draft' && !selected && !entries.has(entry.id)) continue;
      if (
        entry.compatibility?.wordpress?.unresolved?.length &&
        !entry.compatibility.wordpress.reviewed
      )
        throw new WeavaError('请先检查来源功能的转换结果：' + entry.title, 400, {
          id: entry.id,
          unresolved: entry.compatibility.wordpress.unresolved,
        });
      const old = entries.get(entry.id);
      if (old?.revisionId === row.revision) continue;
      entries.set(entry.id, {
        ...entry,
        status: 'published',
        publishedAt: entry.publishedAt || old?.publishedAt || time,
        html: renderDocument(entry.document),
        modifiedAt: publicationModifiedAt(entry, row.updatedAt),
        revisionId: row.revision,
      });
    }
  for (const id of options.withdrawIds ?? []) {
    if (selected?.has(id)) throw new WeavaError('同一内容不能同时发布和撤下。');
    const old = previous?.entries.find((entry) => entry.id === id);
    if (
      !old ||
      (options.withdrawRevisions?.[id] !== undefined &&
        old.revisionId !== options.withdrawRevisions[id])
    )
      throw new WeavaError('待撤下的公开内容已变化，请重新检查。', 409);
    entries.delete(id);
  }
  applySiteInfo(entries, settings, snapshot.settings.revision, time, previous?.entries);
  return entries;
}

export function projectPublicationTerms(
  site: Pick<PublicationSite, 'store' | 'terms'>,
  context: Pick<PublicationSnapshot, 'previous' | 'scope' | 'watch'>,
  entries: Map<string, PublishedEntry>,
) {
  const { previous, scope, watch } = context;
  const terms: Term[] =
    ['entries', 'layouts', 'routes'].includes(scope) && previous
      ? [...(previous.terms ?? [])]
      : site.terms().map((row) => row.value);
  const previousEntries = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  const unchangedTerms = !!previous && digest(terms) === digest(previous.terms ?? []);
  for (const entry of entries.values()) {
    if (unchangedTerms && previousEntries.get(entry.id) === entry && entry.termIds) continue;
    if (isReservedContentPath(normalizePath(entry.path)))
      throw new WeavaError('这个网址由系统使用：' + entry.path);
    // Legacy records receive stable references in the candidate, without rewriting author history.
    const normalized = entry.termIds
      ? entry
      : { ...entry, termIds: { categories: [] as string[], tags: [] as string[] } };
    if (!entry.termIds)
      for (const key of ['categories', 'tags'] as const)
        for (const label of entry[key]) {
          const kind = key === 'categories' ? 'category' : 'tag';
          let term = terms.find((term) => term.kind === kind && term.label === label);
          if (!term) {
            term = {
              id: kind + '-' + digest(label).slice(0, 16),
              kind,
              label,
              slug: label.replace(/[/?#\\\s]/g, '-'),
            };
            terms.push(term);
          }
          normalized.termIds![key].push(term.id);
        }
    for (const id of [...normalized.termIds!.categories, ...normalized.termIds!.tags])
      if (!terms.some((term) => term.id === id)) {
        watch('term', [id]);
        const term = site.store.get('term', id)?.value;
        if (term) terms.push(term);
      }
    const projected = {
      ...projectTerms(normalized, terms),
      blocks: bindBlockTerms(normalized.blocks, [...(previous?.terms ?? []), ...terms]),
    };
    entries.set(
      entry.id,
      immutableDigest(projected) === immutableDigest(entry) ? entry : projected,
    );
  }
  return terms;
}

export function projectPublicationLayouts(
  context: Pick<PublicationSnapshot, 'previous' | 'scope' | 'snapshot' | 'watch'>,
  release: Release,
) {
  const { previous, scope, snapshot, watch } = context,
    { types, settings } = release;
  const catalog = new Map(
    (['entries', 'settings', 'terms', 'routes'].includes(scope) && previous
      ? (previous.layouts ?? builtInLayouts)
      : snapshot.layouts
    ).map((layout) => [layout.id, layout]),
  );
  const include = (id: string, seen = new Set<string>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    let layout = catalog.get(id);
    if (!layout) {
      watch('layout', [id]);
      layout = snapshot.layouts.find((item) => item.id === id);
      if (!layout) throw new WeavaError('布局不存在：' + id);
      catalog.set(id, layout);
    }
    visitBlocks(layout.blocks, (block) => {
      if (block.type === 'shared') include(block.props.layoutId, seen);
    });
  };
  for (const entry of release.entries) {
    include(
      entry.template ??
        (entry.kind === 'content'
          ? (types.find((type) => type.id === entry.type)?.template ?? 'article')
          : 'page'),
    );
    if (publishedHasBlocks(entry))
      visitBlocks(entry.blocks, (block) => {
        if (block.type === 'shared') include(block.props.layoutId);
      });
  }
  for (const id of Object.values(settings.regions ?? {})) if (id) include(id);
  release.layouts = [...catalog.values()];
}
