import { WeavaError as DomainError } from '@weava/contracts';
import type { Analytics } from './analytics.ts';
import type { Engagement } from './engagement.ts';
import { imageAttributes } from './media-display.ts';
import { queryDrafts } from './query.ts';
import { siteFeatures } from './site-features.ts';
import type { Site } from './site.ts';
import { projectTerms } from './taxonomy.ts';
export function queryAdminEntries(
  site: Site,
  analytics: Pick<Analytics, 'viewTotals'>,
  engagement: Pick<Engagement, 'countsFor'>,
  options: Parameters<typeof queryDrafts>[1],
) {
  const result = queryDrafts(site, options);
  const publishedIds = new Set(result.items.filter((row) => row.published).map((row) => row.id));
  const entries =
    site.visibleRelease()?.entries.filter((entry) => publishedIds.has(entry.id)) ?? [];
  const published = new Map(entries.map((entry) => [entry.id, entry]));
  const features = siteFeatures(site.root);
  const counts = features.includes('engagement')
    ? engagement.countsFor(entries.map((entry) => entry.id))
    : new Map();
  const views =
    features.includes('analytics') && entries.length ? analytics.viewTotals(entries) : new Map();
  return {
    ...result,
    items: result.items.map((row) => {
      const entry = published.get(row.id);
      const thumbnail = row.value.cover
        ? imageAttributes(site, row.value.cover, { width: 100, height: 68 })
        : undefined;
      return {
        ...row,
        thumbnail: thumbnail?.src ?? '',
        thumbnailSrcset: thumbnail?.srcset,
        thumbnailSizes: thumbnail?.sizes,
        ...(entry
          ? {
              publication: { path: entry.path, publishedAt: entry.publishedAt },
              metrics: {
                ...counts.get(row.id),
                ...(views.has(row.id) ? { views: views.get(row.id) } : {}),
              },
            }
          : {}),
      };
    }),
  };
}
export function adminEntry(site: Pick<Site, 'entryStore' | 'terms'>, id: string) {
  const row = site.entryStore.get(id);
  if (!row) throw new DomainError('内容不存在。', 404);
  const revision = site.entryStore.publishedRevision(id);
  return {
    ...row,
    published: revision !== undefined,
    hasChanges: revision !== row.revision,
    value: projectTerms(
      row.value,
      site.terms().map((row) => row.value),
    ),
  };
}
export const contentTypes = (site: Pick<Site, 'entryStore'>) => site.entryStore.types();
export function entryIdAtPath(site: Pick<Site, 'entryStore' | 'settings'>, input: string) {
  const path = new URL(input, site.settings().value.domain).pathname;
  return site.entryStore.idAtPath(path);
}
export function entryLabel(site: Pick<Site, 'entryStore'>, id: string) {
  const entry = site.entryStore.get(id)?.value;
  return { title: entry?.title ?? id, path: entry?.path ?? '' };
}
export function commentEntryIds(site: Pick<Site, 'entryStore'>, query = '') {
  return site.entryStore.matchingIds(query);
}
