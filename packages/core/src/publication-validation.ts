import type {Release,PublishedEntry,Block} from '@weava/contracts';
import {load} from 'cheerio';
import {digest} from '../../runtime-common/src/identity.ts';
import {BoundedCache} from './cache.ts';
import {renderSharedRegion,renderEntryTemplate,resolveContentLinks} from './render.ts';
import {referencedLayouts} from './layouts.ts';
import {mediaReferencesIn} from './media-references.ts';
import {releaseIndex} from './release-index.ts';
import {normalizePath} from './paths.ts';
import {publishedObjectKey} from './release-reader.ts';

const fingerprints = new WeakMap<object, string>();
/** Only use on published immutable objects, never on an in-progress editor value. */
export function immutableDigest(value: object): string {
  let key = fingerprints.get(value);
  if (!key) { key = publishedObjectKey(value) ?? digest({kind:'entry',value}); fingerprints.set(value, key); }
  return key;
}
export function publicationDependencies(entry: PublishedEntry, release: Release, custom = false) {
  const index = releaseIndex(release), targets = new Set<string>(), seen = new Set<string>();
  let catalog = custom;
  const scan = (value: unknown) => {
    const json = JSON.stringify(value);
    for (const match of json.matchAll(/entry:([^\s"'<>#)\\]+)/g)) {
      try { targets.add(decodeURIComponent(match[1])); } catch { targets.add(match[1]); }
    }
  };
  const blocks = (items: Block[]) => { for (const block of items) {
    if (['cards','content-list','taxonomy'].includes(block.type)) catalog = true;
    if (block.type === 'content-detail' && block.props.entryId) targets.add(block.props.entryId);
    blocks(block.children ?? []);
  } };
  scan([entry.document, entry.fields, entry.blocks]); blocks(entry.blocks);
  for (const layout of referencedLayouts(entry, release)) { scan(layout.blocks); blocks(layout.blocks); }
  const visit = (id: string) => {
    if (seen.has(id)) return; seen.add(id);
    const target = index.byId.get(id);
    if (target) {
      const before = new Set(targets); scan([target.document, target.fields, target.blocks]); blocks(target.blocks);
      for (const layout of referencedLayouts(target,release)) { scan(layout.blocks); blocks(layout.blocks); }
      for (const next of targets) if (!before.has(next)) visit(next);
    }
  };
  for (const id of targets) visit(id);
  return { targets: [...targets].sort().map(id => [id, index.byId.get(id) ? immutableDigest(index.byId.get(id)!) : null]),
    // Dynamic content and custom renderers may depend on any entry, including authored HTML.
    catalog: catalog ? release.entries.map(item => immutableDigest(item)) : undefined };
}

export interface ValidatedReferences { media: string[]; links: string[] }
const caches = new WeakMap<object, BoundedCache<string, ValidatedReferences>>();
export function validatedReferences(owner: object, entry: PublishedEntry, release: Release,
  renderers: Record<string, any>, environment: string): ValidatedReferences {
  let cache = caches.get(owner);
  if (!cache) { cache = new BoundedCache(20000, 16 * 1024 * 1024); caches.set(owner, cache); }
  const key = digest([immutableDigest(entry), environment, publicationDependencies(entry, release, !!Object.keys(renderers).length)]);
  const reusable = !Object.keys(renderers).length;
  const found = reusable ? cache.get(key) : undefined; if (found) return found;
  const options = { strict: true, validation: true };
  const html = resolveContentLinks(renderSharedRegion('header', release, entry, renderers, options) +
    renderSharedRegion('before', release, entry, renderers, options) + renderEntryTemplate(entry, release, renderers, options) +
    renderSharedRegion('after', release, entry, renderers, options) + renderSharedRegion('footer', release, entry, renderers, options), release, true);
  const media = [...mediaReferencesIn([html, entry.blocks, entry.fields, entry.cover])];
  const links: string[] = [];
  if (!entry.compatibility) {
    const $ = load(html);
    $('a[href]').each((_i, node) => { const href = $(node).attr('href') ?? ''; if (href.startsWith('/') && !href.startsWith('//')) links.push(normalizePath(href)); });
  }
  const result = { media, links: [...new Set(links)] };
  return reusable ? cache.set(key, result, JSON.stringify(result).length * 2 + key.length * 2) : result;
}
