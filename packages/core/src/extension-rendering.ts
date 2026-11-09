import { WeavaError, type Entry, type Release } from '@weava/contracts';
import type { Extension } from './extensions.ts';
import { customEvidence, pageMetadata, type MetadataContribution } from './seo.ts';
export async function renderExtension(
  active: readonly Extension[],
  entry: Entry,
  release: Release,
) {
  for (const ext of active) {
    const html = await ext.render?.(entry, release);
    if (html != null) return customEvidence(html, entry);
  }
  return null;
}
export async function extensionMetadata(
  active: readonly Extension[],
  entry: Entry | undefined,
  release: Release,
  url: URL,
  options: Parameters<typeof pageMetadata>[3] = {},
) {
  let contribution: MetadataContribution = {};
  if (entry)
    for (const ext of active) {
      const value = await ext.metadata?.(entry, release, url);
      if (value)
        contribution = {
          ...contribution,
          ...value,
          schema: [...(contribution.schema ?? []), ...(value.schema ?? [])],
        };
    }
  return pageMetadata(entry, release, url, { ...options, contribution });
}
export async function validateExtensionRelease(active: readonly Extension[], release: Release) {
  // Routing-only extensions have no page output to validate.
  if(!active.some(extension=>extension.render||extension.metadata))return;
  for (const entry of release.entries)
    try {
      const html = await renderExtension(active, entry, release);
      await extensionMetadata(
        active,
        entry,
        release,
        new URL(entry.path, release.settings.domain),
        { html: html ?? undefined },
      );
    } catch (error: any) {
      throw new WeavaError('扩展无法渲染“' + entry.title + '”：' + error.message, 400, {
        id: entry.id,
      });
    }
}
export async function extensionRoute(
  active: readonly Extension[],
  request: Request,
  release: Release | null,
) {
  for (const ext of active) {
    const response = await ext.route?.(request, release);
    if (response != null) return response;
  }
  return null;
}
