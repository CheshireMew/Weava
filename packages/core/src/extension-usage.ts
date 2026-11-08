import type { ExtensionMember } from './extension-catalog.ts';
import { visitBlocks } from './layouts.ts';
import type { Site } from './site.ts';
export function extensionUsage(
  site: Pick<Site, 'store' | 'release' | 'settings'>,
  members: readonly ExtensionMember[],
  configured: (member: ExtensionMember) => boolean,
  id: string,
) {
  const ext = members.find((member) => member.id === id)?.extension;
  const result: { kind: string; id: string; label: string }[] = [];
  if (!ext) return result;
  const inspect = (kind: string, id: string, label: string, value: any) => {
    let used = false;
    visitBlocks(value.blocks ?? [], (block) => {
      if (block.type.startsWith(ext.id + ':')) used = true;
    });
    if (
      (ext.contentTypes ?? []).some((type) => value.kind === 'content' && type.id === value.type) ||
      (ext.themes ?? []).some((theme) => value.theme === theme.id)
    )
      used = true;
    if (used) result.push({ kind, id, label });
  };
  const usesWidget = (fields: any[]): boolean =>
    fields.some(
      (field) => !!ext.fieldWidgets?.[field.widget] || (field.fields && usesWidget(field.fields)),
    );
  for (const row of site.store.list('type'))
    if (usesWidget(row.value.fields))
      result.push({ kind: 'type', id: row.id, label: row.value.label });
  for (const type of site.release()?.types ?? [])
    if (usesWidget(type.fields))
      result.push({ kind: 'published-type', id: type.id, label: type.label });
  for (const row of site.store.list('entry')) inspect('entry', row.id, row.value.title, row.value);
  for (const row of site.store.list('layout'))
    inspect('layout', row.id, row.value.label, row.value);
  inspect('settings', 'site', '网站设置工作稿', site.settings().value);
  const release = site.release();
  if (release) {
    for (const entry of release.entries) inspect('published', entry.id, entry.title, entry);
    for (const layout of release.layouts ?? [])
      inspect('published-layout', layout.id, layout.label, layout);
    inspect('published-settings', 'site', '公开网站设置', release.settings);
  }
  for (const member of members)
    if (
      configured(member) &&
      member.extension?.dependencies?.some((dependency) => dependency.id === id)
    )
      result.push({ kind: 'extension', id: member.id, label: member.extension.label ?? member.id });
  return result;
}
