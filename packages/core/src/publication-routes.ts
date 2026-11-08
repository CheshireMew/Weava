import { WeavaError, type PublishedEntry, type Release } from '@weava/contracts';
export function projectPublicationRoutes(
  previous: Release | null,
  aliases: Release['redirects'],
  entries: Map<string, PublishedEntry>,
  paths: Map<string, string>,
) {
  const redirects = { ...previous?.redirects, ...aliases };
  for (const [from, value] of Object.entries(redirects)) if (value.disabled) delete redirects[from];
  for (const old of previous?.entries ?? []) {
    const changed = entries.get(old.id);
    if (changed && old.path !== changed.path && !paths.has(old.path))
      redirects[old.path] = { target: changed.path, entryId: old.id };
  }
  for (const [from, alias] of Object.entries(redirects)) {
    if (paths.has(from)) {
      delete redirects[from];
      continue;
    }
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
      seen.add(target);
      target = redirects[target].target;
    }
    if (seen.has(target)) throw new WeavaError('网址跳转形成循环：' + from);
    redirects[from] = { ...alias, target };
  }
  return redirects;
}
