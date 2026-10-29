import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { WeavaError, entrySchema, type Entry, type FieldDefinition, type PublishOptions, type Release, type Settings, type Term } from '@weava/contracts';
import type { Site } from './site.ts';
import { normalizePath } from './site.ts';
import { now, uuid, digest } from './storage.ts';
import { renderDocument, validateFields } from './documents.ts';
import { renderEntryTemplate, renderSharedRegion, resolveContentLinks, renderNavigation } from './render.ts';
import { storeRelease } from './publication-store.ts';
import { projectTerms, bindBlockTerms } from './taxonomy.ts';
import { layouts, builtInLayouts, validateLayouts, visitBlocks } from './layouts.ts';
import type { Layout } from '@weava/contracts';
import { validateSeo } from './seo.ts';

export function preparePublication(site: Site, options: PublishOptions = {}) {
  const transition = site.store.state('extension-transition');
  if (transition) {
    let alive = false; try { process.kill(JSON.parse(transition).pid, 0); alive = true; } catch {}
    if (alive) throw new WeavaError('扩展正在切换，请稍后重新发布。', 409);
  }
  if (options.baseReleaseId !== undefined && options.baseReleaseId !== (site.store.state('release') ?? null))
    throw new WeavaError('公开版本已变化，请重新查看发布内容。', 409);
  if (options.reviewRevision !== undefined && options.reviewRevision !== (site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as any).n)
    throw new WeavaError('工作稿已变化，请重新查看发布内容。', 409);
  const scope = options.scope ?? (options.ids ? 'entries' : 'all');
  if (!['all', 'entries', 'settings', 'layouts', 'terms'].includes(scope)) throw new WeavaError('发布范围无效。');
  if (scope === 'entries' && !options.ids?.length) throw new WeavaError('请选择需要发布的内容。');
  if (scope !== 'entries' && options.ids !== undefined) throw new WeavaError('发布范围与内容选择不一致。');
  const snapshot = site.store.raw.transaction(() => ({ previous: site.release(), drafts: site.store.list('entry'),
    settings: site.settings(), types: site.store.list('type').map((row) => row.value),
    aliases: Object.fromEntries(site.store.list('redirect').map((row) => [row.id, row.value])),
    layouts: layouts(site).map((row) => row.value as Layout) }))();
  if (scope === 'settings' && options.settingsRevision !== undefined && options.settingsRevision !== snapshot.settings.revision)
    throw new WeavaError('待发布设置已变化，请重新载入。', 409);
  const previous = snapshot.previous;
  let settings: Settings = ['entries', 'layouts', 'terms'].includes(scope) && previous ? previous.settings : snapshot.settings.value;
  const types = ['settings', 'layouts', 'terms'].includes(scope) && previous ? previous.types : snapshot.types;
  const selected = scope === 'entries' ? new Set(options.ids!) : null;
  if (selected) for (const id of selected) {
    const row = snapshot.drafts.find((draft) => draft.id === id);
    if (!row) throw new WeavaError('内容不存在：' + id, 404);
    if (options.revisions?.[id] !== undefined && options.revisions[id] !== row.revision)
      throw new WeavaError('待发布内容已变化，请重新载入。', 409);
  }
  if (options.versions) {
    if (!selected || Object.keys(options.versions).some((id) => !selected.has(id))) throw new WeavaError('指定修订必须属于本次选择的内容。');
    for (const [id, revision] of Object.entries(options.versions)) {
      const historical = site.store.raw.prepare("SELECT data,created_at FROM revisions WHERE scope='entry' AND id=? AND revision=?").get(id, revision) as { data: string; created_at: string } | undefined;
      if (!historical) throw new WeavaError('指定的内容修订不存在：' + id, 404);
      const index = snapshot.drafts.findIndex((row) => row.id === id);
      snapshot.drafts[index] = { id, revision, value: JSON.parse(historical.data), updatedAt: historical.created_at };
    }
  }
  const entries = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  const time = now();
  if (!['settings', 'layouts', 'terms'].includes(scope)) for (const row of snapshot.drafts) {
    if (selected && !selected.has(row.id)) continue;
    const entry = entrySchema.parse(row.value);
    if (entry.status === 'archived') { entries.delete(entry.id); continue; }
    if (entry.status === 'draft' && !selected && !entries.has(entry.id)) continue;
    if (entry.compatibility?.wordpress?.unresolved?.length && !entry.compatibility.wordpress.reviewed)
      throw new WeavaError('请先检查来源功能的转换结果：' + entry.title, 400, { id: entry.id, unresolved: entry.compatibility.wordpress.unresolved });
    const old = entries.get(entry.id);
    if (old?.revisionId === row.revision) continue;
    entries.set(entry.id, { ...entry, status: 'published', publishedAt: entry.publishedAt || old?.publishedAt || time,
      html: renderDocument(entry.document), modifiedAt: row.updatedAt, revisionId: row.revision });
  }
  const terms: Term[] = ['entries', 'layouts'].includes(scope) && previous ? [...(previous.terms ?? [])] : site.terms().map((row) => row.value);
  for (const entry of entries.values()) {
    // Legacy records receive stable references in the candidate, without rewriting author history.
    const normalized = entry.termIds ? entry : { ...entry, termIds: { categories: [] as string[], tags: [] as string[] } };
    if (!entry.termIds) for (const key of ['categories', 'tags'] as const) for (const label of entry[key]) {
      const kind = key === 'categories' ? 'category' : 'tag';
      let term = terms.find((term) => term.kind === kind && term.label === label);
      if (!term) { term = { id: kind + '-' + digest(label).slice(0, 16), kind, label, slug: label.replace(/[/?#\\\s]/g, '-') }; terms.push(term); }
      normalized.termIds![key].push(term.id);
    }
    for (const id of [...normalized.termIds!.categories, ...normalized.termIds!.tags])
      if (!terms.some((term) => term.id === id)) {
        const term = site.store.get('term', id)?.value;
        if (term) terms.push(term);
      }
    entries.set(entry.id, { ...projectTerms(normalized, terms), blocks: bindBlockTerms(normalized.blocks, [...(previous?.terms ?? []), ...terms]) });
  }
  if (!['entries', 'layouts'].includes(scope) || !previous) settings = { ...settings, taxonomies: settings.taxonomies.map((item) => {
    const term = terms.find((term) => term.id === item.id || (term.kind === 'category' && term.label === item.label));
    return term ? { ...item, ...term } : item;
  }) };
  const redirects = { ...snapshot.aliases, ...previous?.redirects };
  const paths = new Map<string, string>();
  for (const entry of entries.values()) {
    if (paths.has(entry.path)) throw new WeavaError('网址重复：' + entry.path);
    paths.set(entry.path, entry.id);
    entrySchema.parse(entry);
    validateSeo(entry, settings.domain);
    site.validateBlocks(entry.blocks, true);
    const definition = types.find((type) => type.id === entry.type);
    if (entry.kind === 'content' && !definition) throw new WeavaError('内容类型不存在：' + entry.type);
    if (definition) validateFields(definition.fields, entry.fields);
  }
  for (const old of previous?.entries ?? []) {
    const changed = entries.get(old.id);
    if (changed && old.path !== changed.path && !paths.has(old.path)) redirects[old.path] = { target: changed.path, entryId: old.id };
  }
  for (const [from, alias] of Object.entries(redirects)) {
    if (paths.has(from)) { delete redirects[from]; continue; }
    if (alias.entryId) {
      const target = entries.get(alias.entryId);
      if (target) redirects[from] = { ...alias, target: target.path };
    }
  }
  for (const [from, alias] of Object.entries(redirects)) {
    const seen = new Set([from]);
    let target = alias.target;
    while (!paths.has(target) && redirects[target]) {
      if (seen.has(target)) throw new WeavaError('网址跳转形成循环：' + from);
      seen.add(target); target = redirects[target].target;
    }
    if (seen.has(target)) throw new WeavaError('网址跳转形成循环：' + from);
    redirects[from] = { ...alias, target };
  }
  const release: Release = { id: uuid(), createdAt: time, entries: [...entries.values()], settings, types,
    redirects, terms, label: options.label ?? (scope === 'settings' ? '发布设置' : '发布') };
  const catalog = new Map((['entries', 'settings', 'terms'].includes(scope) && previous ? previous.layouts ?? builtInLayouts : snapshot.layouts).map((layout) => [layout.id, layout]));
  const include = (id: string, seen = new Set<string>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    let layout = catalog.get(id);
    if (!layout) {
      layout = snapshot.layouts.find((item) => item.id === id);
      if (!layout) throw new WeavaError('布局不存在：' + id);
      catalog.set(id, layout);
    }
    visitBlocks(layout.blocks, (block) => { if (block.type === 'shared') include(block.props.layoutId, seen); });
  };
  for (const entry of release.entries) {
    include(entry.template ?? (entry.kind === 'content' ? types.find((type) => type.id === entry.type)?.template ?? 'article' : 'page'));
    visitBlocks(entry.blocks, (block) => { if (block.type === 'shared') include(block.props.layoutId); });
  }
  for (const id of Object.values(settings.regions ?? {})) if (id) include(id);
  release.layouts = [...catalog.values()];
  site.validateReleaseExtensions(release);
  validateLayouts(release.layouts);
  for (const layout of release.layouts) site.validateBlocks(layout.blocks);
  const missing: any[] = [];
  const references = (defs: FieldDefinition[], values: Record<string, any>, id: string) => {
    for (const field of defs) {
      const value = values[field.key];
      if (value === undefined || value === null || value === '') continue;
      for (const item of field.multiple ? value : [value]) {
        if (field.type === 'reference' && !entries.has(item)) missing.push({ id, field: field.key, reference: item });
        if (field.type === 'group') references(field.fields ?? [], item, id);
      }
    }
  };
  const validPath = (path: string, seen = new Set<string>()): boolean => {
    if (paths.has(path) || /^\/(media|api|video|search)(\/|$)/.test(path) || ['/rss.xml', '/sitemap.xml', '/robots.txt'].includes(path)) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const alias = redirects[path];
    return !!alias && (!alias.entryId || entries.has(alias.entryId)) && validPath(alias.target, seen);
  };
  for (const entry of entries.values()) {
    const definition = types.find((type) => type.id === entry.type);
    if (definition) references(definition.fields, entry.fields, entry.id);
    let html: string;
    try {
      html = resolveContentLinks(renderSharedRegion('header', release, entry, site.blockRenderers, { strict: true }) +
        renderSharedRegion('before', release, entry, site.blockRenderers, { strict: true }) + renderEntryTemplate(entry, release, site.blockRenderers, { strict: true }) +
        renderSharedRegion('after', release, entry, site.blockRenderers, { strict: true }) + renderSharedRegion('footer', release, entry, site.blockRenderers, { strict: true }), release, true);
    } catch (error: any) { throw new WeavaError(`“${entry.title}”无法渲染：${error.message}`, 400, { id: entry.id }); }
    const source = html + JSON.stringify(entry.blocks) + JSON.stringify(entry.fields) + ' ' + entry.cover;
    for (const match of source.matchAll(/\/media\/[\w%./@+~-]+/g)) {
      const path = decodeURIComponent(match[0].replace(/[\\]+$/, ''));
      if (!existsSync(join(site.root, path.slice(1)))) missing.push({ id: entry.id, path });
    }
    if (!entry.compatibility) {
      const $ = load(html);
      $('a[href]').each((_i, node) => {
        const href = $(node).attr('href') ?? '';
        if (!href.startsWith('/') || href.startsWith('//')) return;
        const path = normalizePath(href);
        if (!validPath(path)) missing.push({ id: entry.id, path });
      });
    }
    // Explicit block references must not silently disappear at runtime.
    const blocks = (items: Entry['blocks']) => items.forEach((block) => {
      if (block.type === 'content-detail' && block.props.entryId && !entries.has(block.props.entryId))
        missing.push({ id: entry.id, blockId: block.id, reference: block.props.entryId });
      blocks(block.children ?? []);
    });
    blocks(entry.blocks);
  }
  if (missing.length) throw new WeavaError('内容或媒体引用无效。', 400, missing.slice(0, 30));
  try { resolveContentLinks(renderNavigation(settings.navigation), release, true); }
  catch (error: any) { throw new WeavaError('导航引用无效：' + error.message); }
  for (const validate of site.publicationValidators) validate(release);
  if (options.failAt === 'validate') throw new WeavaError('测试：发布校验失败。');
  const before = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  const changes = {
    scope, baseReleaseId: previous?.id ?? null,
    settingsChanged: digest(previous?.settings ?? null) !== digest(settings),
    layoutsChanged: digest(previous?.layouts ?? builtInLayouts) !== digest(release.layouts),
    termsChanged: digest(previous?.terms ?? []) !== digest(terms),
    entries: release.entries.filter((entry) => digest(before.get(entry.id) ?? null) !== digest(entry))
      .map((entry) => ({ id: entry.id, title: entry.title, path: entry.path, revision: entry.revisionId, action: before.has(entry.id) ? 'update' : 'add' })),
    removed: [...before.values()].filter((entry) => !entries.has(entry.id)).map(({ id, title, path }) => ({ id, title, path })),
  };
  return { release, changes };
}

export function publish(site: Site, options: PublishOptions = {}) {
  const { release, changes } = preparePublication(site, options);
  site.store.raw.transaction(() => {
    if ((site.store.state('release') ?? null) !== changes.baseReleaseId)
      throw new WeavaError('公开版本在发布期间发生变化，请重试。', 409);
    storeRelease(site.store.raw, release);
    if (options.failAt === 'commit') throw new WeavaError('测试：发布提交失败。');
    site.store.setState('release', release.id);
    if (options.jobId) site.updateJob(options.jobId, { status: 'complete', message: '发布已完成。',
      result: { releaseId: release.id, entries: release.entries.length, changes } });
  }).immediate();
  return release;
}
