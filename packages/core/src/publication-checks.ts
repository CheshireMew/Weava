import {
  WeavaError,
  contentBlockIssues,
  effectiveFields,
  entrySchema,
  fieldIssues,
  type Entry,
  type FieldDefinition,
  type PublishedEntry,
  type Release,
} from '@weava/contracts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../../runtime-common/src/identity.ts';
import { validateFields } from './documents.ts';
import { entrySummary, validateEditorial } from './editorial.ts';
import { validateLayouts } from './layouts.ts';
import type { PublicationSite } from './publication-context.ts';
import { validatedReferences, validationRuntimeIdentity,immutableDigest } from './publication-validation.ts';
import {BoundedCache} from './cache.ts';
import { invalidateReleaseIndex } from './release-index.ts';
import { publishedHasBlocks, publishedObjectKey } from './release-reader.ts';
import { renderBlocks, renderNavigation, resolveContentLinks } from './render.ts';
import { validateSeo } from './seo.ts';
import { siteRoutes } from './site-routes.ts';
const checkedEntries=new WeakMap<object,BoundedCache<string,boolean>>();

export function validatePublicationEntries(
  site: PublicationSite,
  entries: Map<string, PublishedEntry>,
  settings: Release['settings'],
  types: Release['types'],
) {
  const paths = new Map<string, string>();
  const environment=digest([validationRuntimeIdentity,settings.domain,types,site.fieldWidgets,site.extensionBlockDefinitions]);
  let cache=checkedEntries.get(site.store);if(!cache){cache=new BoundedCache(20000,4*1024*1024);checkedEntries.set(site.store,cache);}
  for (const entry of entries.values()) {
    if (paths.has(entry.path)) throw new WeavaError('网址重复：' + entry.path);
    paths.set(entry.path, entry.id);
    const checkKey=immutableDigest(entry)+':'+environment;
    if(cache.get(checkKey))continue;
    if (!publishedObjectKey(entry)) entrySchema.parse(entry);
    validateSeo(entry, settings.domain);
    const entryBlocks = publishedHasBlocks(entry) ? entry.blocks : [];
    site.validateBlocks(entryBlocks, true);
    const definition = types.find((type) => type.id === entry.type);
    if (entry.kind === 'content' && !definition)
      throw new WeavaError('内容类型不存在：' + entry.type);
    if (definition)
      validateFields(effectiveFields(definition.fields, site.fieldWidgets), entry.fields);
    if (entry.kind === 'content' && definition) {
      const blocked = contentBlockIssues(entryBlocks, definition);
      if (blocked.length)
        throw new WeavaError(blocked.map((issue) => issue.message).join('；'), 400, blocked);
    }
    cache.set(checkKey,true,checkKey.length*2+32);
  }
  return paths;
}

export function validatePublicationRelease(
  site: PublicationSite,
  release: Release,
  entries: Map<string, PublishedEntry>,
  paths: Map<string, string>,
) {
  const { settings, types } = release,
    redirects = release.redirects ?? {};
  for (const [position, entry] of release.entries.entries()) {
    if (!entry.description) {
      const description = entrySummary(
        entry,
        entry.blocks.length
          ? renderBlocks(entry.blocks, release, entry, site.blockRenderers)
          : entry.html,
        (blocks) => renderBlocks(blocks, release, entry, site.blockRenderers),
      );
      if (description !== entry.description) {
        const updated = { ...entry, description };
        entries.set(entry.id, updated);
        release.entries[position] = updated;
      }
    }
  }
  invalidateReleaseIndex(release);
  validateEditorial(release);
  site.validateReleaseExtensions(release);
  validateLayouts(release.layouts!);
  for (const layout of release.layouts!) site.validateBlocks(layout.blocks);
  const missing: any[] = [];
  const references = (defs: FieldDefinition[], values: Record<string, any>, id: string) => {
    const errors = fieldIssues(effectiveFields(defs, site.fieldWidgets), values, {
      prefix: 'fields.',
      reference: (target) => entries.get(target),
      requireReferences: true,
    });
    if (errors.length)
      throw new WeavaError(
        errors.some((error) => error.code === 'reference')
          ? '内容字段校验失败，引用无效。'
          : '内容字段校验失败。',
        400,
        errors.map((error) => ({ id, ...error })),
      );
  };
  const customRoutes = siteRoutes(site.root);
  const validPath = (path: string, seen = new Set<string>()): boolean => {
    if (customRoutes.matches(path)) return true;
    if (
      paths.has(path) ||
      /^\/(media|api|video|search)(\/|$)/.test(path) ||
      ['/rss.xml', '/sitemap.xml', '/robots.txt'].includes(path)
    )
      return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const alias = redirects[path];
    return (
      !!alias && (!alias.entryId || entries.has(alias.entryId)) && validPath(alias.target, seen)
    );
  };
  const validationEnvironment = digest([
    validationRuntimeIdentity,
    settings,
    types,
    release.layouts,
    release.terms,
    Object.entries(site.blockRenderers).map(([key, render]) => [key, String(render)]),
  ]);
  const mediaExists = new Map<string, boolean>();
  for (const entry of entries.values()) {
    const definition = types.find((type) => type.id === entry.type);
    if (definition) references(definition.fields, entry.fields, entry.id);
    let refs: ReturnType<typeof validatedReferences>;
    try {
      refs = validatedReferences(
        site.store,
        entry,
        release,
        site.blockRenderers,
        validationEnvironment,
      );
    } catch (error: any) {
      throw new WeavaError(`“${entry.title}”无法渲染：${error.message}`, 400, { id: entry.id });
    }
    for (const path of refs.media) {
      if (!mediaExists.has(path))
        mediaExists.set(path, existsSync(join(process.env.WEAVA_RESOURCE_ROOT ?? site.root, decodeURIComponent(path.slice(1)))));
      if (!mediaExists.get(path)) missing.push({ id: entry.id, path });
    }
    for (const path of refs.links) if (!validPath(path)) missing.push({ id: entry.id, path });
    // Explicit block references must not silently disappear at runtime.
    const blocks = (items: Entry['blocks']) =>
      items.forEach((block) => {
        if (
          block.type === 'content-detail' &&
          block.props.entryId &&
          !entries.has(block.props.entryId)
        )
          missing.push({ id: entry.id, blockId: block.id, reference: block.props.entryId });
        blocks(block.children ?? []);
      });
    if (publishedHasBlocks(entry)) blocks(entry.blocks);
  }
  if (missing.length) throw new WeavaError('内容或媒体引用无效。', 400, missing.slice(0, 30));
  try {
    resolveContentLinks(renderNavigation(settings.navigation), release, true);
  } catch (error: any) {
    throw new WeavaError('导航引用无效：' + error.message);
  }
  for (const validate of site.publicationValidators) validate(release);
}
