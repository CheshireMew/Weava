import type { Entry, PublishedEntry, Release } from '@weava/contracts';

const indexes = new WeakMap<Release, ReturnType<typeof createIndex>>();
export const entryLabels = (entry: Entry) => [...(entry.termIds?.tags ?? entry.tags).map(id => 'tag:' + id), ...(entry.termIds?.categories ?? entry.categories).map(id => 'category:' + id)];
export const newestFirst = (a: PublishedEntry, b: PublishedEntry) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id);
function createIndex(release: Release) {
  const byId = new Map(release.entries.map(entry => [entry.id, entry]));
  const byPath = new Map(release.entries.map(entry => [entry.path, entry]));
  const publicEntries = release.entries.filter(entry => entry.visibility !== 'private');
  const posts = publicEntries.filter(entry => entry.kind === 'content');
  const recommendable = posts.filter(entry => entry.indexable).sort(newestFirst);
  const byLabel = new Map<string, PublishedEntry[]>();
  for (const entry of recommendable) for (const label of new Set(entryLabels(entry))) {
    const items = byLabel.get(label) ?? []; items.push(entry); byLabel.set(label, items);
  }
  return { byId, byPath, publicEntries, posts: posts.sort(newestFirst), recommendable, byLabel };
}
/** Release objects are immutable once composed. Weak keys cannot retain archived versions. */
export function releaseIndex(release: Release) {
  let index = indexes.get(release);
  if (!index) { index = createIndex(release); indexes.set(release, index); }
  return index;
}
export function invalidateReleaseIndex(release: Release) { indexes.delete(release); }
