import { normalizePath } from './paths.ts';

import { privateMedia } from './media-policy.ts';

import { loadRelease, searchRelease } from './publication-store.ts';
import { preparePublication, publish, savePublicationReview } from './publication.ts';

import { visitBlocks } from './layouts.ts';

import {
  blockTypes,
  WeavaError,
  type Settings,
  type Release,
  type Block,
  type PublishOptions,
} from '@weava/contracts';
import type { Site } from './site.ts';
import { releaseIndex } from './release-index.ts';
export class SiteReleases {
  private releaseCache = new Map<string, Release>();
  private publicCache = new WeakMap<Release,Release>();
  constructor(
    private site: Pick<
      Site,
      | 'store'
      | 'blockRenderers'
      | 'extensionThemes'
      | 'isPrivateMedia'
      | 'previewPublication'
      | 'publish'
      | 'release'
      | 'saveEntry'
      | 'validateReleaseExtensions'
      | 'visibleRelease'
      | 'withdrawalOptions'
    > &
      import('./publication.ts').PublicationSite,
  ) {}
  release(id?: string): Release | null {
    const key = id ?? this.site.store.state('release');
    if (!key) return null;
    const cached = this.releaseCache.get(key);
    if (cached)
      return !id || this.site.store.raw.prepare('SELECT 1 FROM releases WHERE id=?').get(key)
        ? cached
        : null;
    const row = this.site.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(key) as any;
    if (!row) return null;
    const release = loadRelease(this.site.store.raw, row.data);
    this.releaseCache.set(key, release);
    if (this.releaseCache.size > 3)
      this.releaseCache.delete(this.releaseCache.keys().next().value!);
    if (this.releaseCache.size > 2)
      this.releaseCache.delete(this.releaseCache.keys().next().value!);
    return release;
  }
  releases() {
    return this.site.store.raw
      .prepare('SELECT id,created_at FROM releases ORDER BY created_at DESC')
      .all() as { id: string; created_at: string }[];
  }
  visibleRelease(includePrivate = false, id?: string): Release | null {
    const release = this.site.release(id);
    if (!release || includePrivate) return release;
    const cached=this.publicCache.get(release);if(cached)return cached;
    const hidden = new Set(
      release.entries.filter((e) => e.visibility === 'private').map((e) => e.path),
    );
    const hiddenIds = new Set(
      release.entries.filter((entry) => entry.visibility === 'private').map((entry) => entry.id),
    );
    const navigation = (items: Settings['navigation']): Settings['navigation'] =>
      items
        .filter((item) => {
          if (item.url.startsWith('entry:'))
            return !hiddenIds.has(decodeURIComponent(item.url.slice(6)));
          try {
            const url = new URL(item.url, release.settings.domain);
            return (
              url.origin !== new URL(release.settings.domain).origin ||
              !hidden.has(normalizePath(url.pathname))
            );
          } catch {
            return true;
          }
        })
        .map((item) => ({
          ...item,
          ...(item.children ? { children: navigation(item.children) } : {}),
        }));
    const visible:Release={
      ...release,
      entries: release.entries.filter((e) => e.visibility !== 'private'),
      settings: { ...release.settings, navigation: navigation(release.settings.navigation) },
    };
    this.publicCache.set(release,visible);return visible;
  }
  isPrivateMedia(path: string) {
    return privateMedia(this.site.store.raw, path);
  }
  redirect(url: URL, includePrivate = false) {
    const path = normalizePath(url.pathname);
    const parameter = url.searchParams.has('p')
      ? 'p'
      : url.searchParams.has('page_id')
        ? 'page_id'
        : null;
    const queryKey =
      path === '/' && parameter ? '/?' + parameter + '=' + url.searchParams.get(parameter) : path;
    const release = this.site.visibleRelease(includePrivate);
    const value = release?.redirects?.[queryKey];
    if (!value || release&&releaseIndex(release).byPath.has(queryKey)) return null;
    if (value.entryId && release&&!releaseIndex(release).byId.has(value.entryId)) return null;
    const target = value.entryId
      ? releaseIndex(release!).byId.get(value.entryId)!.path
      : value.target;
    if (target === path && queryKey === path) return null;
    if (!includePrivate && target.startsWith('/media/') && this.site.isPrivateMedia(target))
      return null;
    const query = new URLSearchParams(url.search);
    if (queryKey !== path && parameter) query.delete(parameter);
    const destination = new URL(target, release!.settings.domain);
    for (const [key, value] of query) destination.searchParams.append(key, value);
    return destination.pathname + destination.search;
  }
  previewPublication(options: PublishOptions = {}) {
    return savePublicationReview(this.site,options,preparePublication(this.site,options));
  }
  publish(options: PublishOptions = {}) {
    return publish(this.site, options);
  }
  withdrawalOptions(id: string, revision: number) {
    const row = this.site.store.get('entry', id);
    if (!row || row.revision !== revision) throw new WeavaError('内容已变化，请重新载入。', 409);
    const published = this.site.release()?.entries.find((entry) => entry.id === id);
    return published
      ? this.site.previewPublication({
          scope: 'entries',
          ids: [],
          withdrawIds: [id],
          withdrawRevisions: { [id]: published.revisionId! },
        }).options
      : null;
  }
  withdraw(id: string, revision: number, archive = false, reviewed?: PublishOptions | null) {
    return this.site.store.raw
      .transaction(() => {
        const row = this.site.store.get('entry', id);
        if (!row || row.revision !== revision)
          throw new WeavaError('内容已变化，请重新载入。', 409);
        const options =
          reviewed === undefined ? this.site.withdrawalOptions(id, revision) : reviewed;
        if (options) this.site.publish(options);
        const saved = this.site.saveEntry(
          { ...row.value, status: archive ? 'archived' : 'draft' },
          revision,
        );
        return saved;
      })
      .immediate();
  }
  rollback(id: string) {
    const release = this.site.release(id);
    if (!release) throw new WeavaError('公开版本不存在。', 404);
    this.site.validateReleaseExtensions(release);
    this.site.store.raw.transaction(() => this.site.store.setState('release', id)).immediate();
    return { releaseId: id };
  }
  validateReleaseExtensions(release: Release) {
    const missing = new Set<string>();
    const check = (block: Block) => {
      if (!blockTypes.includes(block.type) && !this.site.blockRenderers[block.type])
        missing.add(block.type);
    };
    for (const entry of release.entries) visitBlocks(entry.blocks, check);
    for (const layout of release.layouts ?? []) visitBlocks(layout.blocks, check);
    if (!['weava', 'newsletter', ...this.site.extensionThemes].includes(release.settings.theme))
      missing.add('主题 ' + release.settings.theme);
    if (missing.size) throw new WeavaError('请先恢复或启用公开版本所需的扩展。', 409, [...missing]);
  }
  search(query: string, releaseId?: string) {
    const release = this.site.visibleRelease(false, releaseId);
    return release ? searchRelease(this.site.store.raw, release, query) : [];
  }
}
