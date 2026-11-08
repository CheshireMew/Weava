import { WeavaError, type Layout, type PublishOptions, type Settings } from '@weava/contracts';
import { layouts } from './layouts.ts';
import { RetryablePublicationConflict, type PublicationSite } from './publication-context.ts';
import { publicationInput, type PublicationInput } from './publication-inputs.ts';
export function publicationSnapshot(site: PublicationSite, options: PublishOptions) {
  const inputs: PublicationInput[] = [];
  const watch = (scope: string, ids?: string[]) =>
    inputs.push(publicationInput(site.store.raw, scope, ids));
  const transition = site.store.state('extension-transition');
  if (transition) {
    let alive = false;
    try {
      process.kill(JSON.parse(transition).pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new RetryablePublicationConflict('扩展正在切换，请稍后重新发布。');
  }
  if (
    options.baseReleaseId !== undefined &&
    options.baseReleaseId !== (site.store.state('release') ?? null)
  )
    throw new WeavaError('公开版本已变化，请重新查看发布内容。', 409);
  const scope = options.scope ?? (options.ids ? 'entries' : 'all');
  if (!['all', 'entries', 'settings', 'layouts', 'terms', 'routes'].includes(scope))
    throw new WeavaError('发布范围无效。');
  if (scope === 'entries' && !options.ids?.length && !options.withdrawIds?.length)
    throw new WeavaError('请选择需要发布的内容。');
  if (options.withdrawIds?.length && scope !== 'entries')
    throw new WeavaError('撤下内容需要使用内容发布范围。');
  if (scope !== 'entries' && options.ids !== undefined)
    throw new WeavaError('发布范围与内容选择不一致。');
  const snapshot = site.store.raw.transaction(() => ({
    previous: site.release(),
    drafts:
      scope === 'entries'
        ? (options.ids ?? []).map((id) => site.store.get('entry', id)).filter((row) => row !== null)
        : scope === 'all'
          ? site.store.list('entry')
          : [],
    settings: site.settings(),
    types: site.store.list('type').map((row) => row.value),
    aliases: Object.fromEntries(site.store.list('redirect').map((row) => [row.id, row.value])),
    layouts: layouts(site).map((row) => row.value as Layout),
  }))();
  if (
    scope === 'settings' &&
    options.settingsRevision !== undefined &&
    options.settingsRevision !== snapshot.settings.revision
  )
    throw new WeavaError('待发布设置已变化，请重新载入。', 409);
  const previous = snapshot.previous;
  if (scope === 'all') watch('entry');
  else if (scope === 'entries') watch('entry', options.ids ?? []);
  if (!previous || scope === 'all' || scope === 'settings') watch('settings');
  if (!previous || scope === 'all' || scope === 'entries') watch('type');
  if (scope === 'all' || scope === 'routes') watch('redirect');
  if (!previous || scope === 'all' || scope === 'layouts') watch('layout');
  if (!previous || ['all', 'settings', 'terms'].includes(scope)) watch('term');
  for (const key of ['extension-config', 'extension-schema', 'extension-block']) watch(key);
  let settings: Settings =
    ['entries', 'layouts', 'terms', 'routes'].includes(scope) && previous
      ? previous.settings
      : snapshot.settings.value;
  const types =
    ['settings', 'layouts', 'terms', 'routes'].includes(scope) && previous
      ? previous.types
      : snapshot.types;
  const selected = scope === 'entries' ? new Set(options.ids!) : null;
  if (selected)
    for (const id of selected) {
      const row = snapshot.drafts.find((draft) => draft.id === id);
      if (!row) throw new WeavaError('内容不存在：' + id, 404);
      if (options.revisions?.[id] !== undefined && options.revisions[id] !== row.revision)
        throw new WeavaError('待发布内容已变化，请重新载入。', 409);
    }
  if (options.versions) {
    if (!selected || Object.keys(options.versions).some((id) => !selected.has(id)))
      throw new WeavaError('指定修订必须属于本次选择的内容。');
    for (const [id, revision] of Object.entries(options.versions)) {
      const historical = site.store.raw
        .prepare(
          "SELECT data,created_at FROM revisions WHERE scope='entry' AND id=? AND revision=?",
        )
        .get(id, revision) as { data: string; created_at: string } | undefined;
      if (!historical) throw new WeavaError('指定的内容修订不存在：' + id, 404);
      const index = snapshot.drafts.findIndex((row) => row.id === id);
      snapshot.drafts[index] = {
        id,
        revision,
        value: JSON.parse(historical.data),
        updatedAt: historical.created_at,
      };
    }
  }
  return { inputs, watch, scope, snapshot, previous, settings, types, selected };
}
export type PublicationSnapshot = ReturnType<typeof publicationSnapshot>;
