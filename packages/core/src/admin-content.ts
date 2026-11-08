import { WeavaError as DomainError } from '@weava/contracts';
import type { Analytics } from './analytics.ts';
import type { Engagement } from './engagement.ts';
import { imageAttributes } from './media.ts';
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
      return {
        ...row,
        thumbnail: row.value.cover ? imageAttributes(site, row.value.cover, 240).src : '',
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
export function adminEntry(site: Pick<Site, 'store' | 'terms'>, id: string) {
  const row = site.store.get('entry', id);
  if (!row) throw new DomainError('内容不存在。', 404);
  return {
    ...row,
    value: projectTerms(
      row.value,
      site.terms().map((row) => row.value),
    ),
  };
}
export const contentTypes = (site: Pick<Site, 'store'>) => site.store.list('type');
export function entryLabel(site: Pick<Site, 'store'>, id: string) {
  const entry = site.store.get('entry', id)?.value;
  return { title: entry?.title ?? id, path: entry?.path ?? '' };
}
