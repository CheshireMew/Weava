import { WeavaError, type PublishOptions, type Release } from '@weava/contracts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../../runtime-common/src/files.ts';
import { digest, now, uuid } from '../../runtime-common/src/identity.ts';
import { canonicalJson } from '../../runtime-common/src/json.ts';
import { builtInLayouts } from './layouts.ts';
import { validatePublicationEntries, validatePublicationRelease } from './publication-checks.ts';
import { RetryablePublicationConflict, type PublicationSite } from './publication-context.ts';
import { publicationInputsCurrent } from './publication-inputs.ts';
import {
  projectPublicationEntries,
  projectPublicationLayouts,
  projectPublicationTerms,
} from './publication-projection.ts';
import { projectPublicationRoutes } from './publication-routes.ts';
import { publicationSnapshot } from './publication-snapshot.ts';
import { prepareReleaseStorage, writeReleaseStorage } from './publication-store.ts';
import {
  immutableDigest,
  restoreValidation,
  validationSnapshot,
  validationRuntimeIdentity,
} from './publication-validation.ts';
import { projectSettingTerms } from './taxonomy.ts';
export { RetryablePublicationConflict, type PublicationSite } from './publication-context.ts';

export function preparePublication(site: PublicationSite, options: PublishOptions = {}) {
  return site.store.raw.transaction(() => buildPublication(site, options))();
}
function buildPublication(site: PublicationSite, options: PublishOptions) {
  const context = publicationSnapshot(site, options);
  const { inputs, scope, previous, snapshot } = context;
  const time = now(),
    entries = projectPublicationEntries(context, options, time);
  const terms = projectPublicationTerms(site, context, entries);
  const settings =
    !['entries', 'layouts', 'routes'].includes(scope) || !previous
      ? projectSettingTerms(context.settings, terms)
      : context.settings;
  const paths = validatePublicationEntries(site, entries, settings, context.types);
  const redirects = projectPublicationRoutes(
    previous,
    ['all', 'routes'].includes(scope) ? snapshot.aliases : {},
    entries,
    paths,
  );
  const release: Release = {
    id: uuid(),
    createdAt: time,
    entries: [...entries.values()],
    settings,
    types: context.types,
    redirects,
    terms,
    label: options.label ?? (scope === 'settings' ? '发布设置' : '发布'),
  };
  projectPublicationLayouts(context, release);
  validatePublicationRelease(site, release, entries, paths);
  if (options.failAt === 'validate') throw new WeavaError('测试：发布校验失败。');
  const before = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  const changes = {
    scope,
    baseReleaseId: previous?.id ?? null,
    settingsChanged: digest(previous?.settings ?? null) !== digest(settings),
    layoutsChanged: digest(previous?.layouts ?? builtInLayouts) !== digest(release.layouts),
    routesChanged: digest(previous?.redirects ?? {}) !== digest(redirects),
    termsChanged: digest(previous?.terms ?? []) !== digest(terms),
    entries: release.entries
      .filter(
        (entry) =>
          before.get(entry.id) !== entry &&
          (!before.has(entry.id) ||
            immutableDigest(before.get(entry.id)!) !== immutableDigest(entry)),
      )
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        path: entry.path,
        cover: entry.cover,
        description: entry.description,
        author: entry.author,
        visibility: entry.visibility,
        revision: entry.revisionId,
        action: before.has(entry.id) ? ('update' as const) : ('add' as const),
      })),
    removed: [...before.values()]
      .filter((entry) => !entries.has(entry.id))
      .map(({ id, title, path }) => ({ id, title, path })),
  };
  const revisions = inputs.flatMap((input) => input.rows.map((row) => row.revision));
  const reviewRevision = revisions.length
    ? revisions.reduce((maximum, revision) => Math.max(maximum, revision), 0)
    : null;
  if (options.reviewRevision !== undefined && options.reviewRevision !== reviewRevision)
    throw new RetryablePublicationConflict('待发布内容已变化，请重新查看发布内容。');
  return { release, changes, reviewRevision, inputs };
}

export type PreparedPublication = ReturnType<typeof preparePublication>;
function candidateOptions(options: PublishOptions) {
  const { candidateId, jobId, failAt, ...value } = options;
  return digest(canonicalJson(value));
}
export function publicationRuntimeKey(site: PublicationSite) {
  return digest([
    'publication-candidate-v3',
    validationRuntimeIdentity,
    existsSync(join(site.root, 'program.json'))
      ? readFileSync(join(site.root, 'program.json'), 'utf8')
      : (process.env.WEAVA_FRAMEWORK ?? process.cwd()),
    walk(join(site.root, 'extensions')).filter(file => !file.replaceAll('\\','/').startsWith(join(site.root,'extensions/state').replaceAll('\\','/')+'/')).map((file) => {
      const info = statSync(file);
      return [file, info.size, info.mtimeMs];
    }),
    Object.entries(site.blockRenderers).map(([key, render]) => [key, (render as any)[Symbol.for('weava.renderer.identity')] ?? String(render)]),
    site.fieldWidgets,
    site.publicationValidators.map(String),
    site.store.raw
      .prepare(
        "SELECT id,revision FROM records WHERE scope IN ('extension-config','extension-schema','extension-block') ORDER BY scope,id",
      )
      .all(),
  ]);
}
export function assertPublicationCurrent(site: PublicationSite, prepared: PreparedPublication) {
  if ((site.store.state('release') ?? null) !== prepared.changes.baseReleaseId)
    throw new RetryablePublicationConflict('公开版本已变化，请重新查看发布内容。');
  if (!prepared.inputs || !publicationInputsCurrent(site.store.raw, prepared.inputs))
    throw new RetryablePublicationConflict('待发布内容或依赖已变化，请重新查看发布内容。');
}
/** A review stores only changed entries; unchanged bodies stay in their base release. */
export function savePublicationReview(
  site: PublicationSite,
  options: PublishOptions,
  prepared: PreparedPublication,
) {
  const id = uuid(),
    reviewed: PublishOptions = {
      ...options,
      baseReleaseId: prepared.changes.baseReleaseId,
      reviewRevision: prepared.reviewRevision,
      candidateId: id,
    };
  const base = new Map(site.release()?.entries.map((entry) => [entry.id, entry]) ?? []);
  const { entries, ...release } = prepared.release;
  const payload = {
    release,
    entries: entries.map((entry) =>
      base.get(entry.id) === entry ||
      (base.has(entry.id) && immutableDigest(base.get(entry.id)!) === immutableDigest(entry))
        ? entry.id
        : entry,
    ),
    changes: prepared.changes,
    validations: entries
      .filter((entry) => base.get(entry.id) !== entry)
      .map((entry) => ({ id: entry.id, value: validationSnapshot(entry) }))
      .filter((item) => !!item.value),
    reviewRevision: prepared.reviewRevision,
    inputs: prepared.inputs,
    optionsKey: candidateOptions(reviewed),
    options: reviewed,
    runtimeKey: publicationRuntimeKey(site),
  };
  const data = JSON.stringify(payload);
  site.store.raw
    .transaction(() => {
      assertPublicationCurrent(site, prepared);
      site.store.raw.prepare('DELETE FROM publication_candidates WHERE expires<?').run(Date.now());
      site.store.raw
        .prepare(
          'DELETE FROM publication_candidates WHERE id IN (SELECT id FROM publication_candidates ORDER BY expires DESC LIMIT -1 OFFSET 15)',
        )
        .run();
      site.store.raw
        .prepare('INSERT INTO publication_candidates VALUES(?,?,?)')
        .run(id, data, Date.now() + 10 * 60000);
    })
    .immediate();
  return { ...prepared.changes, options: reviewed };
}
export function readPublicationCandidate(
  site: PublicationSite,
  options: PublishOptions,
): PreparedPublication {
  if (!options.candidateId) return preparePublication(site, options);
  const row = site.store.raw
    .prepare('SELECT data FROM publication_candidates WHERE id=? AND expires>?')
    .get(options.candidateId, Date.now()) as { data: string } | undefined;
  if (!row) throw new WeavaError('发布预览已过期，请重新查看发布内容。', 409);
  const data = JSON.parse(row.data);
  if (
    data.optionsKey !== candidateOptions(options) ||
    data.runtimeKey !== publicationRuntimeKey(site)
  )
    throw new WeavaError('发布选项或渲染程序已变化，请重新查看发布内容。', 409);
  const base = new Map(site.release()?.entries.map((entry) => [entry.id, entry]) ?? []);
  const prepared: PreparedPublication = {
    release: {
      ...data.release,
      entries: data.entries.map((entry: any) =>
        typeof entry === 'string' ? base.get(entry) : entry,
      ),
    },
    changes: data.changes,
    reviewRevision: data.reviewRevision,
    inputs: data.inputs,
  };
  assertPublicationCurrent(site, prepared);
  for (const item of data.validations ?? []) {
    const entry = prepared.release.entries.find((entry) => entry.id === item.id);
    if (entry) restoreValidation(entry, item.value);
  }
  if (prepared.release.entries.some((entry) => !entry))
    throw new WeavaError('候选内容已不可用，请重新查看发布内容。', 409);
  // Application validators can depend on external state and must not be skipped by caching.
  for (const validate of site.publicationValidators) validate(prepared.release);
  return prepared;
}
/** The confirmation preview uses the reviewed release, including its settings and templates. */
export function readPublicationPreview(site: PublicationSite, candidateId: string): Release {
  const row = site.store.raw.prepare('SELECT data FROM publication_candidates WHERE id=? AND expires>?')
    .get(candidateId, Date.now()) as { data: string } | undefined;
  const options = row ? JSON.parse(row.data).options as PublishOptions | undefined : undefined;
  if (!options || options.candidateId !== candidateId)
    throw new WeavaError('发布预览已过期，请重新查看发布内容。', 409);
  return readPublicationCandidate(site, options).release;
}
export function commitPublication(
  site: PublicationSite,
  prepared: PreparedPublication,
  options: PublishOptions = {},
  complete?: (release: Release) => void,
  guard?: () => void,
) {
  const { release, changes } = prepared;
  assertPublicationCurrent(site, prepared);
  const storage = prepareReleaseStorage(site.store.raw, release);
  site.store.raw
    .transaction(() => {
      assertPublicationCurrent(site, prepared);
      site.store.assertTask();
      guard?.();
      writeReleaseStorage(site.store.raw, storage);
      if (options.failAt === 'commit') throw new WeavaError('测试：发布提交失败。');
      site.store.setState('release', release.id);
      if (options.jobId)
        site.updateJob(options.jobId, {
          status: 'complete',
          message: '发布已完成。',
          result: { releaseId: release.id, entries: release.entries.length, changes },
        });
      complete?.(release);
    })
    .immediate();
  return release;
}
export function publish(site: PublicationSite, options: PublishOptions = {}) {
  return commitPublication(site, readPublicationCandidate(site, options), options);
}
