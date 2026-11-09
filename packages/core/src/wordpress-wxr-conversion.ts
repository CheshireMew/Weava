import {
  WeavaError,
  type ContentType,
  type Entry,
  type Settings,
  type Term,
} from '@weava/contracts';
import { basename } from 'node:path';
import { digest } from '../../runtime-common/src/identity.ts';
import { plain } from './documents.ts';
import type { SiteExchange } from './exchange.ts';
import { EntryWorkspace, StagedEntries } from './staged-entries.ts';
import { convertWxrEntry, type Conversion } from './wordpress-wxr-content.ts';
import { wxrLinks } from './wordpress-wxr-links.ts';
import { optionKey, type WxrOptions } from './wordpress-wxr-options.ts';
import { wxrTerms } from './wordpress-wxr-taxonomy.ts';
import {
  children,
  date,
  itemFromXml,
  parseXml,
  text,
  titleText,
  type Item,
  type WxrInput,
  type Xml,
} from './wordpress-wxr-xml.ts';
export interface ParsedWxr { items: Item[]; channel: Xml }
export function parseWxrSource(xml: WxrInput, workspace?: EntryWorkspace): ParsedWxr {
  const items: Item[] = [];
  const channel = parseXml(xml, node => {
    const item = itemFromXml(node);
    items.push(workspace ? workspace.record('item', item, ['body','excerpt','meta','comments']) : item);
  });
  return { items, channel };
}
export interface WxrTarget {
  fingerprint: string;
  known?: { attachments?: { url: string; local?: string | null }[] };
  terms: Term[];
  types: ContentType[];
  settings: Settings;
  revision: number;
  releaseId: string | null;
  paths: { id: string; path: string }[];
}
export function convertWxr(
  target: WxrTarget,
  xml: WxrInput,
  options: WxrOptions = {},
  mediaMap: Record<string, string> = {},
  workspace?: EntryWorkspace,
  parsed?: ParsedWxr,
) {
  const { fingerprint, known } = target;
  mediaMap = {
    ...Object.fromEntries(
      (known?.attachments ?? [])
        .filter((asset: any) => asset.local)
        .flatMap((asset: any) => [
          [asset.url, asset.local],
          [new URL(asset.url).pathname, asset.local],
        ]),
    ),
    ...mediaMap,
  };
  const {items,channel} = parsed ?? parseWxrSource(xml, workspace);
  const
    sourceUrl = text(channel, 'wp:base_blog_url') || text(channel, 'link');
  let origin: URL;
  try {
    origin = new URL(sourceUrl);
    if (!['https:', 'http:'].includes(origin.protocol)) throw new Error();
  } catch {
    throw new WeavaError('WordPress 来源站点网址无效。');
  }
  const namespace = digest(origin.href.replace(/\/$/, '')).slice(0, 12),
    entryId = (id: string) => 'wordpress:' + namespace + ':' + id;
  const warnings: string[] = [],
    skipped: { id: string; type: string; reason: string }[] = [],
    conversions: Conversion[] = [];
  const authors = new Map(
    children(channel, 'wp:author').map((node) => [
      text(node, 'wp:author_login'),
      text(node, 'wp:author_display_name'),
    ]),
  );
  const seen = new Set<string>();
  for (const item of items) {
    if (!/^\d+$/.test(item.id) || seen.has(item.id))
      throw new WeavaError('WordPress 内容编号缺失或重复：' + item.id);
    seen.add(item.id);
  }
  const systemTypes = new Set([
    'attachment',
    'revision',
    'nav_menu_item',
    'wp_navigation',
    'wp_template',
    'wp_template_part',
    'wp_block',
    'custom_css',
    'customize_changeset',
    'wp_global_styles',
    'wp_font_family',
    'wp_font_face',
  ]);
  const content = items.filter((item) => {
    const reason = systemTypes.has(item.type)
      ? '来源系统对象，保存在原始 WXR 资料中'
      : item.status === 'auto-draft' && !item.body.trim()
        ? '空自动草稿'
        : '';
    if (reason) skipped.push({ id: item.id, type: item.type, reason });
    return !reason;
  });
  const termMap = wxrTerms(channel, content, namespace, target.terms, warnings);
  const itemsById = new Map(items.map((item) => [item.id, item])),
    contentById = new Map(content.map((item) => [item.id, item]));
  const typeIds = new Map<string, string>([['post', 'post']]);
  const types: ContentType[] = [];
  for (const item of content.filter((item) => item.type !== 'page'))
    if (!typeIds.has(item.type) || !types.some((type) => type.id === typeIds.get(item.type))) {
      const id =
        item.type === 'post' ? 'post' : 'wp-' + item.type.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if ([...typeIds].some(([source, value]) => source !== item.type && value === id))
        throw new WeavaError('WordPress 内容类型转换后的编号重复：' + item.type);
      typeIds.set(item.type, id);
      const existing = target.types.find((type) => type.id === id);
      types.push(
        existing ?? {
          id,
          label: item.type === 'post' ? '文章' : item.type,
          fields: [],
          pathPrefix: item.type === 'post' ? '/posts/' : '/' + id + '/',
          template: 'article',
        },
      );
    }
  const links = wxrLinks(content, typeIds, origin, entryId, mediaMap),
    { paths } = links;
  const context = {
    entryId,
    conversions,
    warnings,
    itemsById,
    termMap,
    typeIds,
    authors,
    namespace,
    links,
  };
  const entries: Entry[] = workspace ? new StagedEntries(workspace) : [];
  for (const item of content) {
    const entry = convertWxrEntry(item, context);
    if (entries instanceof StagedEntries) entries.append(entry);
    else entries.push(entry);
  }
  const entryIds = new Set(entries.map((entry) => entry.id));
  const existingPaths = new Map(
    target.paths.filter((row) => !entryIds.has(row.id)).map((row) => [row.path, row.id]),
  );
  for (const entry of entries) {
    if (existingPaths.has(entry.path))
      throw new WeavaError('导入网址重复：' + entry.path, 409, {
        existingId: existingPaths.get(entry.path),
        importedId: entry.id,
      });
    existingPaths.set(entry.path, entry.id);
  }
  const attachments = items
    .filter((item) => item.type === 'attachment' && item.media)
    .map((item) => ({
      id: item.id,
      url: new URL(item.media, origin).href,
      title: item.title,
      caption: titleText(item.excerpt),
      alt: item.meta._wp_attachment_image_alt?.[0] ?? '',
      name: basename(new URL(item.media, origin).pathname),
    }));
  const comments = content.flatMap((item) =>
    item.comments
      .filter((node) => ['comment', ''].includes(text(node, 'wp:comment_type')))
      .map((node) => ({
        id: 'wpcomment:' + namespace + ':' + text(node, 'wp:comment_id'),
        entryId: entryId(item.id),
        author: titleText(text(node, 'wp:comment_author')) || '访客',
        body: plain(text(node, 'wp:comment_content')),
        status: text(node, 'wp:comment_approved') === '1' ? 'visible' : 'hidden',
        createdAt: date(text(node, 'wp:comment_date_gmt')) ?? '1970-01-01T00:00:00.000Z',
        parent: text(node, 'wp:comment_parent'),
      })),
  );
  if (comments.some((comment) => comment.parent !== '0' && comment.parent))
    warnings.push('来源评论的回复关系保留在 WXR 中，本站以时间列表展示。');
  const redirects: NonNullable<SiteExchange['redirects']> = {};
  for (const item of content) {
    const alias = { target: paths.get(item.id)!, entryId: entryId(item.id) };
    redirects['/?p=' + item.id] = alias;
    if (item.type === 'page') redirects['/?page_id=' + item.id] = alias;
    for (const slug of item.meta._wp_old_slug ?? [])
      if (slug && !/[/?#\\]/.test(slug)) {
        const path = paths.get(item.id)!.replace(/[^/]+\/$/, slug + '/');
        if (path !== alias.target) redirects[path] = alias;
      }
  }
  const value: SiteExchange = {
    version: 1,
    types,
    entries,
    terms: [...termMap.values()],
    redirects,
    ...(options.settings
      ? {
          settings: {
            ...target.settings,
            name: titleText(text(channel, 'title')) || target.settings.name,
            description: titleText(text(channel, 'description')),
            language: text(channel, 'language') || target.settings.language,
          },
        }
      : {}),
  };
  const report = {
    source: origin.href,
    fingerprint,
    totalItems: items.length,
    entries: entries.length,
    pages: entries.filter((entry) => entry.kind === 'page').length,
    content: entries.filter((entry) => entry.kind === 'content').length,
    types: types.map((type) => ({ id: type.id, label: type.label })),
    terms: termMap.size,
    attachments: attachments.map(({ id, url, name }) => ({
      id,
      url,
      name,
      local: mediaMap[url] ?? null,
    })),
    comments: options.comments === false ? 0 : comments.length,
    skipped,
    conversions,
    warnings: [...new Set(warnings)],
    reviewRequired: conversions.filter((row) => row.unresolved.length),
    review: {
      fingerprint,
      revision: target.revision,
      releaseId: target.releaseId,
      options: optionKey(options),
    },
    published: false,
    notes: [
      'WXR 包含内容资料，主题、插件程序、菜单位置和服务器配置需要另行设置。',
      '原始 XML 会保存在站点的 imports 目录。未知来源功能需要检查后才能发布。',
      ...(options.downloadMedia || options.mediaDirectory
        ? []
        : ['附件保留来源网址；本次不会下载附件。']),
    ],
  };
  return { value, report, attachments, comments };
}
