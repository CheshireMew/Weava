import { mediaReferencesIn } from './media-references.ts';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { effectiveFields, fieldIssues, contentBlockIssues, isReservedContentPath, WeavaError, entrySchema, type Entry, type FieldDefinition, type PublishOptions, type Release, type Settings, type Term } from '@weava/contracts';
import type { Site } from './site.ts';
import { normalizePath } from './paths.ts';
import { now, uuid, digest, walk } from './storage.ts';
import { renderDocument, validateFields } from './documents.ts';
import { renderBlocks, renderEntryTemplate, renderSharedRegion, resolveContentLinks, renderNavigation } from './render.ts';
import { prepareReleaseStorage,writeReleaseStorage } from './publication-store.ts';
import { validateEditorial, entrySummary } from './editorial.ts';
import { projectTerms, bindBlockTerms } from './taxonomy.ts';
import { layouts, builtInLayouts, validateLayouts, visitBlocks } from './layouts.ts';
import type { Layout } from '@weava/contracts';
import { validateSeo } from './seo.ts';
import { publicationModifiedAt } from './source-content.ts';
import { immutableDigest, validatedReferences } from './publication-validation.ts';
import { invalidateReleaseIndex } from './release-index.ts';
import { applySiteInfo } from './site-info.ts';

export type PublicationSite = Pick<Site, 'store' | 'root' | 'settings' | 'release' | 'terms' | 'fieldWidgets' | 'blockRenderers' | 'publicationValidators' | 'validateBlocks' | 'validateReleaseExtensions' | 'updateJob'>;
export function preparePublication(site: PublicationSite, options: PublishOptions = {}) {
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
  if (!['all', 'entries', 'settings', 'layouts', 'terms', 'routes'].includes(scope)) throw new WeavaError('发布范围无效。');
  if (scope === 'entries' && !options.ids?.length && !options.withdrawIds?.length) throw new WeavaError('请选择需要发布的内容。');
  if (options.withdrawIds?.length && scope !== 'entries') throw new WeavaError('撤下内容需要使用内容发布范围。');
  if (scope !== 'entries' && options.ids !== undefined) throw new WeavaError('发布范围与内容选择不一致。');
  const snapshot = site.store.raw.transaction(() => ({ previous: site.release(),
    drafts: scope === 'entries' ? (options.ids ?? []).map(id => site.store.get('entry', id)).filter(row => row !== null) : scope === 'all' ? site.store.list('entry') : [],
    reviewRevision: (site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as {n:number|null}).n,
    settings: site.settings(), types: site.store.list('type').map((row) => row.value),
    aliases: Object.fromEntries(site.store.list('redirect').map((row) => [row.id, row.value])),
    layouts: layouts(site).map((row) => row.value as Layout) }))();
  if (scope === 'settings' && options.settingsRevision !== undefined && options.settingsRevision !== snapshot.settings.revision)
    throw new WeavaError('待发布设置已变化，请重新载入。', 409);
  const previous = snapshot.previous;
  let settings: Settings = ['entries', 'layouts', 'terms', 'routes'].includes(scope) && previous ? previous.settings : snapshot.settings.value;
  const types = ['settings', 'layouts', 'terms', 'routes'].includes(scope) && previous ? previous.types : snapshot.types;
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
  if (!['settings', 'layouts', 'terms', 'routes'].includes(scope)) for (const row of snapshot.drafts) {
    if (selected && !selected.has(row.id)) continue;
    const entry = entrySchema.parse(row.value);
    if (entry.status === 'archived') { entries.delete(entry.id); continue; }
    if (entry.status === 'draft' && !selected && !entries.has(entry.id)) continue;
    if (entry.compatibility?.wordpress?.unresolved?.length && !entry.compatibility.wordpress.reviewed)
      throw new WeavaError('请先检查来源功能的转换结果：' + entry.title, 400, { id: entry.id, unresolved: entry.compatibility.wordpress.unresolved });
    const old = entries.get(entry.id);
    if (old?.revisionId === row.revision) continue;
    entries.set(entry.id, { ...entry, status: 'published', publishedAt: entry.publishedAt || old?.publishedAt || time,
      html: renderDocument(entry.document), modifiedAt: publicationModifiedAt(entry, row.updatedAt), revisionId: row.revision });
  }
  for (const id of options.withdrawIds ?? []) {
    if (selected?.has(id)) throw new WeavaError('同一内容不能同时发布和撤下。');
    const old = previous?.entries.find((entry) => entry.id === id);
    if (!old || options.withdrawRevisions?.[id] !== undefined && old.revisionId !== options.withdrawRevisions[id]) throw new WeavaError('待撤下的公开内容已变化，请重新检查。', 409);
    entries.delete(id);
  }
  applySiteInfo(entries, settings, snapshot.settings.revision, time, previous?.entries);
  const terms: Term[] = ['entries', 'layouts', 'routes'].includes(scope) && previous ? [...(previous.terms ?? [])] : site.terms().map((row) => row.value);
  const previousEntries=new Map(previous?.entries.map(entry=>[entry.id,entry])??[]);
  const unchangedTerms=!!previous&&digest(terms)===digest(previous.terms??[]);
  for (const entry of entries.values()) {
    if(unchangedTerms&&previousEntries.get(entry.id)===entry&&entry.termIds)continue;
    if (isReservedContentPath(normalizePath(entry.path))) throw new WeavaError('这个网址由系统使用：' + entry.path);
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
    const projected = { ...projectTerms(normalized, terms), blocks: bindBlockTerms(normalized.blocks, [...(previous?.terms ?? []), ...terms]) };
    entries.set(entry.id, immutableDigest(projected) === immutableDigest(entry) ? entry : projected);
  }
  if (!['entries', 'layouts', 'routes'].includes(scope) || !previous) settings = { ...settings, taxonomies: settings.taxonomies.map((item) => {
    const term = terms.find((term) => term.id === item.id || (term.kind === 'category' && term.label === item.label));
    return term ? { ...item, ...term } : item;
  }) };
  const redirects = { ...previous?.redirects, ...(['all', 'routes'].includes(scope) ? snapshot.aliases : {}) };
  for (const [from, value] of Object.entries(redirects)) if (value.disabled) delete redirects[from];
  const paths = new Map<string, string>();
  for (const entry of entries.values()) {
    if (paths.has(entry.path)) throw new WeavaError('网址重复：' + entry.path);
    paths.set(entry.path, entry.id);
    entrySchema.parse(entry);
    validateSeo(entry, settings.domain);
    site.validateBlocks(entry.blocks, true);
    const definition = types.find((type) => type.id === entry.type);
    if (entry.kind === 'content' && !definition) throw new WeavaError('内容类型不存在：' + entry.type);
    if (definition) validateFields(effectiveFields(definition.fields, site.fieldWidgets), entry.fields);
    if(entry.kind==='content'&&definition) { const blocked=contentBlockIssues(entry.blocks,definition); if(blocked.length)throw new WeavaError(blocked.map((issue)=>issue.message).join('；'),400,blocked); }
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
  const catalog = new Map((['entries', 'settings', 'terms', 'routes'].includes(scope) && previous ? previous.layouts ?? builtInLayouts : snapshot.layouts).map((layout) => [layout.id, layout]));
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
  for (const [position, entry] of release.entries.entries()) {
    if (!entry.description && entry.summaryMode && entry.summaryMode !== 'manual') {
      const description = entrySummary(entry, entry.blocks.length ? renderBlocks(entry.blocks, release, entry, site.blockRenderers) : entry.html, (blocks) => renderBlocks(blocks, release, entry, site.blockRenderers));
      if (description !== entry.description) { const updated = {...entry,description}; entries.set(entry.id,updated); release.entries[position]=updated; }
    }
  }
  invalidateReleaseIndex(release);
  validateEditorial(release);
  site.validateReleaseExtensions(release);
  validateLayouts(release.layouts);
  for (const layout of release.layouts) site.validateBlocks(layout.blocks);
  const missing: any[] = [];
  const references = (defs: FieldDefinition[], values: Record<string, any>, id: string) => {
    const errors = fieldIssues(effectiveFields(defs, site.fieldWidgets), values, { prefix: 'fields.', reference: (target) => entries.get(target), requireReferences: true });
    if (errors.length) throw new WeavaError(errors.some((error) => error.code === 'reference') ? '内容字段校验失败，引用无效。' : '内容字段校验失败。', 400, errors.map((error) => ({ id, ...error })));
  };
  const validPath = (path: string, seen = new Set<string>()): boolean => {
    if (paths.has(path) || /^\/(media|api|video|search)(\/|$)/.test(path) || ['/rss.xml', '/sitemap.xml', '/robots.txt'].includes(path)) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const alias = redirects[path];
    return !!alias && (!alias.entryId || entries.has(alias.entryId)) && validPath(alias.target, seen);
  };
  const validationEnvironment = digest([settings, types, release.layouts, release.terms, Object.entries(site.blockRenderers).map(([key, render]) => [key,String(render)])]);
  const mediaExists = new Map<string, boolean>();
  for (const entry of entries.values()) {
    const definition = types.find((type) => type.id === entry.type);
    if (definition) references(definition.fields, entry.fields, entry.id);
    let refs: ReturnType<typeof validatedReferences>;
    try {
      refs = validatedReferences(site.store, entry, release, site.blockRenderers, validationEnvironment);
    } catch (error: any) { throw new WeavaError(`“${entry.title}”无法渲染：${error.message}`, 400, { id: entry.id }); }
    for (const path of refs.media) {
      if (!mediaExists.has(path)) mediaExists.set(path, existsSync(join(site.root, decodeURIComponent(path.slice(1)))));
      if (!mediaExists.get(path)) missing.push({ id: entry.id, path });
    }
    for (const path of refs.links) if (!validPath(path)) missing.push({ id: entry.id, path });
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
    routesChanged: digest(previous?.redirects ?? {}) !== digest(redirects),
    termsChanged: digest(previous?.terms ?? []) !== digest(terms),
    entries: release.entries.filter((entry) => before.get(entry.id) !== entry && (!before.has(entry.id) || immutableDigest(before.get(entry.id)!) !== immutableDigest(entry)))
      .map((entry) => ({ id: entry.id, title: entry.title, path: entry.path, revision: entry.revisionId, action: before.has(entry.id) ? 'update' as const : 'add' as const })),
    removed: [...before.values()].filter((entry) => !entries.has(entry.id)).map(({ id, title, path }) => ({ id, title, path })),
  };
  return { release, changes, reviewRevision: snapshot.reviewRevision };
}

export type PreparedPublication = ReturnType<typeof preparePublication>;
function candidateOptions(options: PublishOptions) {
  const { candidateId, jobId, failAt, ...value } = options;
  const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])])) : item;
  return digest(canonical(value));
}
export function publicationRuntimeKey(site: PublicationSite) {
  return digest(['publication-candidate-v1', existsSync(join(site.root,'program.json'))?readFileSync(join(site.root,'program.json'),'utf8'):process.env.WEAVA_FRAMEWORK??process.cwd(),
    walk(join(site.root,'extensions')).map(file => { const info=statSync(file); return [file,info.size,info.mtimeMs]; }),
    Object.entries(site.blockRenderers).map(([key,render])=>[key,String(render)]), site.fieldWidgets,
    site.publicationValidators.map(String), site.store.raw.prepare("SELECT id,revision FROM records WHERE scope IN ('extension-config','extension-schema','extension-block') ORDER BY scope,id").all()]);
}
export function assertPublicationCurrent(site: PublicationSite, prepared: PreparedPublication) {
  if ((site.store.state('release') ?? null) !== prepared.changes.baseReleaseId) throw new WeavaError('公开版本已变化，请重新查看发布内容。',409);
  if ((site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as {n:number|null}).n !== prepared.reviewRevision) throw new WeavaError('工作稿已变化，请重新查看发布内容。',409);
}
/** A review stores only changed entries; unchanged bodies stay in their base release. */
export function savePublicationReview(site: PublicationSite, options: PublishOptions, prepared: PreparedPublication) {
  const id=uuid(), reviewed:PublishOptions={...options,baseReleaseId:prepared.changes.baseReleaseId,reviewRevision:prepared.reviewRevision,candidateId:id};
  const base=new Map(site.release()?.entries.map(entry=>[entry.id,entry])??[]);
  const {entries,...release}=prepared.release;
  const payload={release,entries:entries.map(entry=>base.get(entry.id)===entry||base.has(entry.id)&&immutableDigest(base.get(entry.id)!)===immutableDigest(entry)?entry.id:entry),changes:prepared.changes,
    reviewRevision:prepared.reviewRevision,optionsKey:candidateOptions(reviewed),runtimeKey:publicationRuntimeKey(site)};
  const data=JSON.stringify(payload);
  site.store.raw.transaction(()=>{
    assertPublicationCurrent(site,prepared);
    site.store.raw.prepare('DELETE FROM publication_candidates WHERE expires<?').run(Date.now());
    site.store.raw.prepare('DELETE FROM publication_candidates WHERE id IN (SELECT id FROM publication_candidates ORDER BY expires DESC LIMIT -1 OFFSET 15)').run();
    site.store.raw.prepare('INSERT INTO publication_candidates VALUES(?,?,?)').run(id,data,Date.now()+10*60000);
  }).immediate();
  return {...prepared.changes,options:reviewed};
}
export function readPublicationCandidate(site: PublicationSite, options: PublishOptions): PreparedPublication {
  if (!options.candidateId) return preparePublication(site,options);
  const row=site.store.raw.prepare('SELECT data FROM publication_candidates WHERE id=? AND expires>?').get(options.candidateId,Date.now()) as {data:string}|undefined;
  if(!row)throw new WeavaError('发布预览已过期，请重新查看发布内容。',409);
  const data=JSON.parse(row.data);
  if(data.optionsKey!==candidateOptions(options)||data.runtimeKey!==publicationRuntimeKey(site))throw new WeavaError('发布选项或渲染程序已变化，请重新查看发布内容。',409);
  const base=new Map(site.release()?.entries.map(entry=>[entry.id,entry])??[]);
  const prepared:PreparedPublication={release:{...data.release,entries:data.entries.map((entry:any)=>typeof entry==='string'?base.get(entry):entry)},changes:data.changes,reviewRevision:data.reviewRevision};
  assertPublicationCurrent(site,prepared);
  if(prepared.release.entries.some(entry=>!entry))throw new WeavaError('候选内容已不可用，请重新查看发布内容。',409);
  // Application validators can depend on external state and must not be skipped by caching.
  for(const validate of site.publicationValidators)validate(prepared.release);
  return prepared;
}
export function commitPublication(site: PublicationSite, prepared: PreparedPublication, options: PublishOptions = {}, complete?: (release:Release)=>void, guard?:()=>void) {
  const { release, changes } = prepared;
  assertPublicationCurrent(site,prepared);
  const storage=prepareReleaseStorage(site.store.raw,release);
  site.store.raw.transaction(() => {
    assertPublicationCurrent(site,prepared);
    guard?.();
    writeReleaseStorage(site.store.raw, storage);
    if (options.failAt === 'commit') throw new WeavaError('测试：发布提交失败。');
    site.store.setState('release', release.id);
    if (options.jobId) site.updateJob(options.jobId, { status: 'complete', message: '发布已完成。',
      result: { releaseId: release.id, entries: release.entries.length, changes } });
    complete?.(release);
  }).immediate();
  return release;
}
export function publish(site: PublicationSite, options: PublishOptions = {}) {
  return commitPublication(site,readPublicationCandidate(site,options),options);
}
