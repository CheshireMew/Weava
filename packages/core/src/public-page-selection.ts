import {
  entrySchema,
  systemRoutes,
  WeavaError,
  type PublishedEntry,
  type Release,
} from '@weava/contracts';
import { renderDocument } from './documents.ts';
import { layouts, referencedLayouts } from './layouts.ts';
import { normalizePath } from './paths.ts';
import { contentQuery, validatePublicQuery, validateQueryFields } from './query.ts';
import type { Site } from './site.ts';
import { wordpressArchiveEntry } from './wordpress-archives.ts';
import { collectionArchiveEntry } from './collections.ts';
import { readPublicationPreview } from './publication.ts';
import { validatePagePagination } from './public-pagination.ts';
export function selectPublicPage(site: Site, url: URL, owner: boolean, snapshot?: Release | null) {
  const preview = url.pathname.startsWith('/__preview/');
  if (preview && !owner) throw new WeavaError('请先登录后台。', 401);
  const candidateId = preview ? url.searchParams.get('candidate') : null;
  const candidate = candidateId ? readPublicationPreview(site, candidateId) : null;
  const publicDocument = Object.values(systemRoutes).some((path) => path === url.pathname);
  let release: Release | null =
    candidate ??
    (snapshot === undefined
      ? site.visibleRelease(owner && !publicDocument)
      : snapshot
        ? site.visibleRelease(owner && !publicDocument, snapshot.id)
        : null) ??
    (preview
      ? {
          id: 'preview',
          createdAt: new Date().toISOString(),
          label: '草稿预览',
          entries: [],
          types: site.entryStore.types().map((r) => r.value),
          settings: site.settings().value,
        }
      : null);
  if (!release) throw new WeavaError('网站尚未发布，请登录后台发布内容。', 503);
  let entry: PublishedEntry | undefined;
  if (preview && candidate) {
    const id = decodeURIComponent(url.pathname.slice(11).replace(/\/$/, ''));
    entry = release.entries.find((entry) => entry.id === id);
    if (!entry) throw new WeavaError('本次发布中没有这篇内容。', 404);
  } else if (preview) {
    const id = decodeURIComponent(url.pathname.slice(11).replace(/\/$/, ''));
    const version = Number(url.searchParams.get('revision'));
    let value = version ? site.entryStore.revision(id, version) : site.entryStore.get(id)?.value;
    if (id.startsWith('layout:')) {
      const layout = layouts(site).find((row) => row.id === id.slice(7))?.value;
      if (!layout) throw new WeavaError('布局不存在。', 404);
      value = entrySchema.parse({
        id,
        kind: layout.appliesTo === 'content' ? 'content' : 'page',
        title: '示例标题',
        description: '示例摘要',
        path: '/layout-preview/',
        type: site.entryStore.types()[0]?.id ?? 'post',
        template: layout.kind === 'template' ? layout.id : 'page',
        document: { version: 1, format: 'markdown', source: '## 示例正文\n\n这里显示内容正文。' },
        blocks: layout.kind === 'template' ? [] : layout.blocks,
      });
    }
    entry = value
      ? {
          ...entrySchema.parse(value),
          html: renderDocument(value.document),
          modifiedAt: value.updatedAt ?? new Date().toISOString(),
          revisionId: version || site.entryStore.get(id)?.revision || 0,
        }
      : undefined;
    if (!entry) throw new WeavaError('草稿修订不存在。', 404);
    release = {
      ...release,
      settings: site.settings().value,
      types: site.entryStore.types().map((r) => r.value),
      layouts: layouts(site).map((row) => row.value),
    };
    const selectedLayout = url.searchParams.get('layout');
    if (selectedLayout) {
      const layout = release.layouts?.find((layout) => layout.id === selectedLayout);
      if (!layout) throw new WeavaError('布局不存在。', 404);
      entry =
        layout.kind === 'template'
          ? { ...entry, template: layout.id }
          : {
              ...entry,
              kind: 'page',
              template: 'page',
              blocks: layout.blocks,
              title: layout.label,
            };
    }
    const previewEntry = entry;
    release = {
      ...release,
      entries: [...release.entries.filter((item) => item.id !== previewEntry.id), previewEntry],
    };
  } else
    entry =
      release.entries.find((v) => v.path === normalizePath(url.pathname)) ??
      collectionArchiveEntry(release, url) ??
      wordpressArchiveEntry(release, url);
  const pageLayouts = entry ? referencedLayouts(entry, release) : [];
  validatePublicQuery(url.searchParams, release, [
    ...(entry?.blocks ?? []),
    ...pageLayouts.flatMap((layout) => layout.blocks),
  ]);
  if (url.pathname === '/search/')
    validateQueryFields(contentQuery(url.searchParams), release.types);
  if (!preview) validatePagePagination(entry, release, url);
  return { preview, release, entry };
}
