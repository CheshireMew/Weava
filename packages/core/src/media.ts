import { isUploadFormat, mediaKind, mediaUploadMaxBytes } from '@weava/contracts';

import { mediaGroupSchema, WeavaError } from '@weava/contracts';
import { load } from 'cheerio';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { digest, now } from '../../runtime-common/src/identity.ts';
import { inside } from '../../runtime-common/src/paths.ts';
import { BoundedCache } from './cache.ts';
import { digestFile } from './file-io.ts';
import { validateMediaFormat } from './media-format.ts';
import { imageDerivatives } from './media-images.ts';
import { updateRevisionReferences } from './media-reference-index.ts';
import { mediaIdentity } from './paths.ts';
import { paginate } from './query.ts';
import type { Site } from './site.ts';
const imageCaches = new WeakMap<
  object,
  { stamp: string; attributes: BoundedCache<string, any>; html: BoundedCache<string, string> }
>();
function imageCache(site: Site) {
  const stamp = site.store.state('media-version') ?? '0';
  let cache = imageCaches.get(site.store);
  if (!cache || cache.stamp !== stamp) {
    cache = {
      stamp,
      attributes: new BoundedCache(2048, 2 * 1024 * 1024),
      html: new BoundedCache(128, 8 * 1024 * 1024),
    };
    imageCaches.set(site.store, cache);
  }
  return cache;
}

export { mediaKind } from '@weava/contracts';
export function queryMedia(site: Site, params: URLSearchParams) {
  const q = (params.get('q') ?? '').toLowerCase(),
    kind = params.get('kind'),
    group = params.get('group');
  const archived = params.get('archived') === 'true';
  const page = Number(params.get('page') ?? 1),
    pageSize = Number(params.get('pageSize') ?? 24);
  paginate([], page, pageSize);
  const clauses = ['archived=?'],
    args: any[] = [archived ? 1 : 0];
  if (group === '__ungrouped__') clauses.push("COALESCE(group_id,'')=''");
  else if (group) {
    clauses.push('group_id=?');
    args.push(group);
  }
  if (q) {
    clauses.push('instr(search,?)>0');
    args.push(q.normalize('NFKC'));
  }
  if (kind) {
    clauses.push('kind=?');
    args.push(kind);
  }
  const where = clauses.join(' AND '),
    total = (
      site.store.raw.prepare('SELECT COUNT(*) n FROM media_list WHERE ' + where).get(...args) as {
        n: number;
      }
    ).n;
  const selected = site.store.raw
    .prepare(
      'SELECT id,revision,data,updated_at FROM media_list WHERE ' +
        where +
        ' ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
    )
    .all(...args, pageSize, (page - 1) * pageSize) as {
    id: string;
    revision: number;
    data: string;
    updated_at: string;
  }[];
  return {
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
    items: selected.map((row) => ({
      id: row.id,
      revision: row.revision,
      value: JSON.parse(row.data),
      updatedAt: row.updated_at,
    })),
  };
}
export const mediaGroups = (site: Site) => site.store.list('media-group');
export function saveMediaGroup(site: Site, input: unknown, revision: number | null) {
  const value = mediaGroupSchema.parse(input);
  return site.store.raw
    .transaction(() => {
      if (
        mediaGroups(site).some(
          (row) =>
            row.id !== value.id &&
            !row.value.archived &&
            !value.archived &&
            row.value.label === value.label,
        )
      )
        throw new WeavaError('已有同名媒体分组。');
      return site.store.put('media-group', value.id, value, revision);
    })
    .immediate();
}
function validGroup(site: Site, id: string | null | undefined) {
  if (id === undefined || id === null || id === '') return;
  if (typeof id !== 'string') throw new WeavaError('媒体分组编号无效。');
  const group = site.store.get('media-group', id);
  if (!group || group.value.archived) throw new WeavaError('媒体分组不存在或已归档。');
}
export function moveMedia(
  site: Site,
  items: { id: string; revision: number }[],
  groupId: string | null,
) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.some(
      (item) => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.revision),
    ) ||
    new Set(items.map((item) => item.id)).size !== items.length
  )
    throw new WeavaError('请选择媒体并提供修订号，每项只能出现一次。');
  return site.store.raw
    .transaction(() => {
      validGroup(site, groupId);
      return items.map((item) => {
        const row = site.store.get('media', item.id);
        if (!row || row.revision !== item.revision)
          throw new WeavaError('媒体信息已变化，请重新载入。', 409);
        return site.store.put(
          'media',
          row.id,
          { ...row.value, groupId: groupId || null },
          row.revision,
          '移动媒体分组',
        );
      });
    })
    .immediate();
}
export function saveMediaMetadata(
  site: Site,
  id: string,
  value: {
    name: string;
    alt?: string;
    caption?: string;
    groupId?: string | null;
    focalPoint?: { x: number; y: number };
  },
  revision: number,
) {
  const row = site.store.get('media', id);
  if (!row || row.revision !== revision) throw new WeavaError('媒体信息已变化，请重新载入。', 409);
  if (
    typeof value?.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 300 ||
    typeof (value.alt ?? '') !== 'string' ||
    (value.alt?.length ?? 0) > 1000 ||
    typeof (value.caption ?? '') !== 'string' ||
    (value.caption?.length ?? 0) > 4000
  )
    throw new WeavaError('媒体名称、说明或图注无效。');
  if (value.groupId !== undefined && value.groupId !== row.value.groupId)
    validGroup(site, value.groupId);
  if (
    value.focalPoint &&
    (['x', 'y'] as const).some(
      (axis) =>
        !Number.isFinite(value.focalPoint![axis]) ||
        value.focalPoint![axis] < 0 ||
        value.focalPoint![axis] > 100,
    )
  )
    throw new WeavaError('图片焦点需要在 0～100 之间。');
  return site.store.put(
    'media',
    id,
    {
      ...row.value,
      name: value.name.trim(),
      alt: value.alt ?? '',
      caption: value.caption ?? '',
      ...(value.groupId !== undefined ? { groupId: value.groupId || null } : {}),
      ...(value.focalPoint ? { focalPoint: value.focalPoint } : {}),
    },
    revision,
    '更新媒体信息',
  );
}
export function archiveMedia(
  site: Site,
  items: { id: string; revision: number }[],
  archived: boolean,
) {
  if (!Array.isArray(items) || !items.length) throw new WeavaError('请选择媒体。');
  return site.store.raw
    .transaction(() =>
      items.map((item) => {
        const row = site.store.get('media', item.id);
        if (!row || row.revision !== item.revision)
          throw new WeavaError('媒体信息已变化，请重新载入。', 409);
        return site.store.put(
          'media',
          row.id,
          { ...row.value, archived },
          row.revision,
          archived ? '归档媒体' : '恢复媒体',
        );
      }),
    )
    .immediate();
}
export function mediaReferences(site: Site, id: string) {
  const media = site.store.get('media', id);
  if (!media) throw new WeavaError('媒体不存在。', 404);
  const urls = new Set(
    [media.value.url, ...(media.value.derivatives ?? []).map((item: any) => item.url)].map(
      mediaIdentity,
    ),
  );
  const paths = [...urls],
    marks = paths.map(() => '?').join(','),
    db = site.store.raw;
  db.transaction(() => updateRevisionReferences(db))();
  const affected = `WITH RECURSIVE affected(id) AS (
    SELECT id FROM authored_media_refs WHERE scope='layout' AND path IN (${marks})
    UNION SELECT edge.id FROM authored_layout_edges edge JOIN affected a ON a.id=edge.target WHERE edge.scope='layout'
    UNION SELECT '@type:'||r.id FROM records r JOIN affected a ON a.id=COALESCE(json_extract(r.data,'$.template'),'article') WHERE r.scope='type'
  ) `;
  const global = !!db
    .prepare(
      affected +
        "SELECT 1 FROM authored_layout_edges WHERE scope='settings' AND target IN affected LIMIT 1",
    )
    .get(...paths);
  const working = db
    .prepare(
      affected +
        `SELECT l.id,json_extract(l.summary,'$.title') title,json_extract(l.summary,'$.path') path FROM entry_list l WHERE ? OR l.id IN (SELECT id FROM authored_media_refs WHERE scope='entry' AND path IN (${marks})) OR l.id IN (SELECT id FROM authored_layout_edges WHERE scope='entry' AND target IN affected) ORDER BY l.id`,
    )
    .all(...paths, global ? 1 : 0, ...paths) as { id: string; title: string; path: string }[];
  const releaseId = site.store.state('release');
  const publishedIds = releaseId
    ? (db
        .prepare(
          `SELECT DISTINCT entry_id FROM publication_entry_media WHERE release_id=? AND path IN (${marks})`,
        )
        .all(releaseId, ...paths) as { entry_id: string }[])
    : [];
  const published = publishedIds.length ? new Set(publishedIds.map((row) => row.entry_id)) : null;
  return {
    working,
    published: published
      ? (site.release()?.entries ?? [])
          .filter((entry) => published.has(entry.id))
          .map(({ id, title, path }) => ({ id, title, path }))
      : [],
    layouts: db
      .prepare(
        `SELECT r.id,json_extract(r.data,'$.label') label FROM records r WHERE r.scope='layout' AND r.id IN (SELECT id FROM authored_media_refs WHERE scope='layout' AND path IN (${marks})) ORDER BY r.id`,
      )
      .all(...paths) as { id: string; label: string }[],
    settings: !!db
      .prepare(
        `SELECT 1 FROM authored_media_refs WHERE scope='settings' AND path IN (${marks}) LIMIT 1`,
      )
      .get(...paths),
    historicalRevisions: (
      db
        .prepare(
          `SELECT COUNT(DISTINCT revision) n FROM revision_media_refs WHERE path IN (${marks})`,
        )
        .get(...paths) as { n: number }
    ).n,
  };
}
export interface ImageCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}
export async function cropMedia(site: Site, id: string, revision: number, crop: ImageCrop) {
  const original = site.store.get('media', id);
  if (!original || original.revision !== revision)
    throw new WeavaError('媒体信息已变化，请重新载入。', 409);
  if (mediaKind(original.value.url) !== 'image') throw new WeavaError('只能裁切图片。');
  if (
    !crop ||
    (['left', 'top', 'width', 'height'] as const).some(
      (key) => typeof crop[key] !== 'number' || !Number.isFinite(crop[key]),
    ) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.left + crop.width > 100 ||
    crop.top + crop.height > 100
  )
    throw new WeavaError('裁切范围需要在图片范围内。');
  const bytes = readFileSync(inside(site.root, original.value.url.slice(1)));
  const rotated = await sharp(bytes, { limitInputPixels: 32000000 }).rotate().png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const left = Math.floor((metadata.width! * crop.left) / 100),
    top = Math.floor((metadata.height! * crop.top) / 100);
  const width = Math.min(
    metadata.width! - left,
    Math.max(1, Math.round((metadata.width! * crop.width) / 100)),
  );
  const height = Math.min(
    metadata.height! - top,
    Math.max(1, Math.round((metadata.height! * crop.height) / 100)),
  );
  const cropped = await sharp(rotated).extract({ left, top, width, height }).png().toBuffer();
  const saved = await uploadMedia(
    site,
    cropped,
    original.value.name.replace(/\.[^.]+$/, '') + '-crop.png',
  );
  if (saved.id === original.id) return saved;
  // Identical crops may already be in the library. Keep their existing lineage and metadata.
  if (saved.value.parentId) return saved;
  return site.store.put(
    'media',
    saved.id,
    {
      ...saved.value,
      alt: original.value.alt ?? '',
      caption: original.value.caption ?? '',
      parentId: original.id,
      crop,
    },
    saved.revision,
    '裁切副本',
  );
}
export function imageAttributes(
  site: Site,
  src: string,
  display: number | { width: number; height: number; sizes?: string } = 960,
) {
  const displayWidth = typeof display === 'number' ? display : display.width * 2;
  const dimensions =
    typeof display === 'number'
      ? {}
      : {
          width: display.width,
          height: display.height,
          sizes: display.sizes ?? `${display.width}px`,
        };
  const key = JSON.stringify(display) + ':' + src;
  const cache = imageCache(site),
    old = cache.attributes.get(key);
  if (old) return { ...old };
  const id = /^\/media\/([a-f0-9]{24})\.[a-z]+$/i.exec(src)?.[1];
  const record = id ? site.store.get('media', id)?.value : null;
  const position = record?.focalPoint
    ? { style: `object-position:${record.focalPoint.x}% ${record.focalPoint.y}%` }
    : {};
  if (!Array.isArray(record?.derivatives) || !record.derivatives.length)
    return { src, ...position, ...dimensions };
  const variants = record.derivatives
    .filter((d: any) => d.url && d.width)
    .sort((a: any, b: any) => a.width - b.width);
  if (!variants.length) return { src, ...position, ...dimensions };
  const result = {
    ...position,
    src: (variants.find((v: any) => v.width >= displayWidth) ?? variants.at(-1)).url,
    srcset: variants.map((v: any) => `${v.url} ${v.width}w`).join(', '),
    sizes: '(max-width: 720px) 100vw, 960px',
    width: record.width,
    height: record.height,
    ...dimensions,
  };
  cache.attributes.set(key, result, JSON.stringify(result).length * 2);
  return { ...result };
}
export function responsiveImages(site: Site, html: string) {
  if (!html.includes('/media/')) return html;
  const cache = imageCache(site),
    key = digest(html),
    old = cache.html.get(key);
  if (old !== undefined) return old;
  const $ = load(html, null, false);
  $('img[src]').each((_i, el) => {
    const node = $(el);
    const attributes = imageAttributes(site, node.attr('src')!);
    if (attributes.style)
      node.attr('style', [node.attr('style'), attributes.style].filter(Boolean).join(';'));
    if (!node.attr('srcset'))
      for (const [key, value] of Object.entries(attributes))
        if (
          key !== 'style' &&
          value !== undefined &&
          (!['width', 'height'].includes(key) || !node.attr(key))
        )
          node.attr(key, String(value));
    if (!node.attr('loading')) node.attr('loading', 'lazy');
    if (!node.attr('decoding')) node.attr('decoding', 'async');
  });
  const result = $.html();
  return cache.html.set(key, result, result.length * 2);
}
export function stageMedia(site: Site, data: Buffer, name: string) {
  if (!data.length || data.length > mediaUploadMaxBytes)
    throw new WeavaError('附件大小需要在 32 MB 以内。');
  const ext = extname(name).toLowerCase();
  if (!isUploadFormat(name)) throw new WeavaError('不支持这个附件格式。');
  validateMediaFormat(data, ext);
  const path = join(site.root, 'media', digest(data).slice(0, 24) + ext);
  if (!existsSync(path)) writeFileSync(path, data);
  return { path, name };
}
export function validateMediaFile(file: string, name: string) {
  const size = statSync(file).size;
  if (!size || size > mediaUploadMaxBytes) throw new WeavaError('附件大小需要在 32 MB 以内。');
  const fd = openSync(file, 'r'),
    buffer = Buffer.allocUnsafe(65536),
    ext = extname(name).toLowerCase();
  try {
    let first = true;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      if (first || ['.txt', '.csv', '.srt', '.vtt'].includes(ext))
        validateMediaFormat(buffer.subarray(0, count), ext);
      if (!['.txt', '.csv', '.srt', '.vtt'].includes(ext)) break;
      first = false;
    }
  } finally {
    closeSync(fd);
  }
  return size;
}
export async function prepareMedia(site: Site, data: Buffer | string, name: string) {
  const size = typeof data === 'string' ? validateMediaFile(data, name) : data.length;
  if (!size || size > mediaUploadMaxBytes) throw new WeavaError('附件大小需要在 32 MB 以内。');
  if (typeof data !== 'string') validateMediaFormat(data, extname(name).toLowerCase());
  const hash = typeof data === 'string' ? digestFile(data) : digest(data),
    id = hash.slice(0, 24);
  const existing = site.store.get('media', id);
  if (
    existing &&
    [existing.value.url, ...(existing.value.derivatives ?? []).map((item: any) => item.url)].every(
      (url) => existsSync(inside(site.root, url.slice(1))),
    )
  )
    return existing;
  const ext = extname(existing?.value.url ?? name).toLowerCase();
  const image = isUploadFormat(ext, true);
  if (!isUploadFormat(ext)) throw new WeavaError('不支持这个附件格式。');
  const file = existing?.value.url?.slice('/media/'.length) ?? id + ext,
    dir = join(site.root, 'media'),
    destination = join(dir, file);
  mkdirSync(dir, { recursive: true });
  if (typeof data === 'string') {
    if (data !== destination) await copyFile(data, destination);
  } else writeFileSync(destination, data);
  // Native image readers may retain file handles on Windows. Read the durable
  // copy so the upload's temporary file can be released before committing it.
  const imageInput = typeof data === 'string' ? destination : data;
  let metadata: any = {};
  if (image) {
    metadata = await sharp(imageInput, { limitInputPixels: 32000000 }).metadata();
    if (!metadata.format || Math.max(metadata.width ?? 0, metadata.height ?? 0) > 12000)
      throw new WeavaError('图片格式或尺寸无效。');
  }
  const derivatives = image
    ? await imageDerivatives(site.root, imageInput, id, metadata, size)
    : [];
  return {
    id,
    revision: existing?.revision ?? null,
    value: {
      id,
      name,
      url: '/media/' + file,
      bytes: size,
      hash,
      width: metadata.autoOrient?.width ?? metadata.width,
      height: metadata.autoOrient?.height ?? metadata.height,
      derivatives,
      createdAt: now(),
      ...(existing?.value ?? {}),
    },
  };
}
export async function uploadMedia(site: Site, data: Buffer | string, name: string) {
  const prepared = await prepareMedia(site, data, name);
  const existing = site.store.get('media', prepared.id);
  return site.store.put('media', prepared.id, prepared.value, existing?.revision ?? null, '上传');
}

export const mediaRecords = (site: Pick<Site, 'store'>) => site.store.list('media');
