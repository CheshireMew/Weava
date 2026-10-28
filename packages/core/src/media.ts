import { join, extname } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { inside } from './storage.ts';
import sharp from 'sharp';
import { digest, now } from './storage.ts';
import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { load } from 'cheerio';
import { paginate } from './query.ts';
import { layouts, referencedLayouts } from './layouts.ts';
export function mediaKind(url: string): 'image' | 'video' | 'audio' | 'file' {
  return /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(url) ? 'image' : /\.(mp4|webm)$/i.test(url) ? 'video' : /\.mp3$/i.test(url) ? 'audio' : 'file';
}
export function queryMedia(site: Site, params: URLSearchParams) {
  const q = (params.get('q') ?? '').toLowerCase(), kind = params.get('kind');
  const archived = params.get('archived') === 'true';
  const items = site.store.list('media').filter((row) => !!row.value.archived === archived && (!q || String(row.value.name).toLowerCase().includes(q)) && (!kind || mediaKind(row.value.url) === kind))
    .sort((a, b) => String(b.value.createdAt).localeCompare(String(a.value.createdAt)) || a.id.localeCompare(b.id));
  return paginate(items, Number(params.get('page') ?? 1), Number(params.get('pageSize') ?? 24));
}
export function saveMediaMetadata(site: Site, id: string, value: { name: string; alt?: string; caption?: string }, revision: number) {
  const row = site.store.get('media', id);
  if (!row || row.revision !== revision) throw new WeavaError('媒体信息已变化，请重新载入。', 409);
  if (typeof value?.name !== 'string' || !value.name.trim() || value.name.length > 300 || typeof (value.alt ?? '') !== 'string' || (value.alt?.length ?? 0) > 1000 ||
    typeof (value.caption ?? '') !== 'string' || (value.caption?.length ?? 0) > 4000) throw new WeavaError('媒体名称、说明或图注无效。');
  return site.store.put('media', id, { ...row.value, name: value.name.trim(), alt: value.alt ?? '', caption: value.caption ?? '' }, revision, '更新媒体信息');
}
export function archiveMedia(site: Site, items: { id: string; revision: number }[], archived: boolean) {
  if (!Array.isArray(items) || !items.length) throw new WeavaError('请选择媒体。');
  return site.store.raw.transaction(() => items.map((item) => {
    const row = site.store.get('media', item.id);
    if (!row || row.revision !== item.revision) throw new WeavaError('媒体信息已变化，请重新载入。', 409);
    return site.store.put('media', row.id, { ...row.value, archived }, row.revision, archived ? '归档媒体' : '恢复媒体');
  })).immediate();
}
export function mediaReferences(site: Site, id: string) {
  const media = site.store.get('media', id);
  if (!media) throw new WeavaError('媒体不存在。', 404);
  const urls = [media.value.url, ...(media.value.derivatives ?? []).map((item: any) => item.url)];
  const uses = (value: unknown) => urls.some((url) => JSON.stringify(value).includes(url));
  const working = { settings: site.settings().value, types: site.store.list('type').map((row) => row.value), layouts: layouts(site).map((row) => row.value) };
  const release = site.release();
  const content = (entry: any) => [entry.cover, entry.fields, entry.blocks, entry.blocks?.length ? null : entry.document];
  return {
    working: site.store.list('entry').filter((row) => uses([content(row.value), referencedLayouts(row.value, working)])).map((row) => ({ id: row.id, title: row.value.title, path: row.value.path })),
    published: (release?.entries ?? []).filter((entry) => uses([content(entry), referencedLayouts(entry, release!)])).map(({ id, title, path }) => ({ id, title, path })),
    layouts: site.store.list('layout').filter((row) => uses(row.value)).map((row) => ({ id: row.id, label: row.value.label })),
    settings: uses(working.settings),
    historicalRevisions: (site.store.raw.prepare("SELECT COUNT(*) n FROM revisions WHERE scope='entry' AND instr(data,?)>0").get(media.value.url) as any).n,
  };
}
export interface ImageCrop { left: number; top: number; width: number; height: number }
export async function cropMedia(site: Site, id: string, revision: number, crop: ImageCrop) {
  const original = site.store.get('media', id);
  if (!original || original.revision !== revision) throw new WeavaError('媒体信息已变化，请重新载入。', 409);
  if (mediaKind(original.value.url) !== 'image') throw new WeavaError('只能裁切图片。');
  if (!crop || (['left', 'top', 'width', 'height'] as const).some((key) => typeof crop[key] !== 'number' || !Number.isFinite(crop[key])) ||
    crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > 100 || crop.top + crop.height > 100)
    throw new WeavaError('裁切范围需要在图片范围内。');
  const bytes = readFileSync(inside(site.root, original.value.url.slice(1)));
  const rotated = await sharp(bytes, { limitInputPixels: 32000000 }).rotate().png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const left = Math.floor(metadata.width! * crop.left / 100), top = Math.floor(metadata.height! * crop.top / 100);
  const width = Math.min(metadata.width! - left, Math.max(1, Math.round(metadata.width! * crop.width / 100)));
  const height = Math.min(metadata.height! - top, Math.max(1, Math.round(metadata.height! * crop.height / 100)));
  const cropped = await sharp(rotated).extract({ left, top, width, height }).png().toBuffer();
  const saved = await uploadMedia(site, cropped, original.value.name.replace(/\.[^.]+$/, '') + '-crop.png');
  if (saved.id === original.id) return saved;
  // Identical crops may already be in the library. Keep their existing lineage and metadata.
  if (saved.value.parentId) return saved;
  return site.store.put('media', saved.id, { ...saved.value, alt: original.value.alt ?? '', caption: original.value.caption ?? '', parentId: original.id, crop }, saved.revision, '裁切副本');
}
export function imageAttributes(site: Site, src: string) {
  const id = /^\/media\/([a-f0-9]{24})\.[a-z]+$/i.exec(src)?.[1];
  const record = id ? site.store.get('media', id)?.value : null;
  if (!Array.isArray(record?.derivatives) || !record.derivatives.length) return { src };
  const variants = record.derivatives
    .filter((d: any) => d.url && d.width)
    .sort((a: any, b: any) => a.width - b.width);
  if (!variants.length) return { src };
  return {
    src: (variants.find((v: any) => v.width >= 960) ?? variants.at(-1)).url,
    srcset: variants.map((v: any) => `${v.url} ${v.width}w`).join(', '),
    sizes: '(max-width: 720px) 100vw, 960px',
    width: record.width,
    height: record.height,
  };
}
export function responsiveImages(site: Site, html: string) {
  if (!html.includes('/media/')) return html;
  const $ = load(html, null, false);
  $('img[src]').each((_i, el) => {
    const node = $(el);
    if (!node.attr('srcset'))
      for (const [key, value] of Object.entries(imageAttributes(site, node.attr('src')!)))
        if (value !== undefined) node.attr(key, String(value));
  });
  return $.html();
}
export function stageMedia(site: Site, data: Buffer, name: string) {
  if (!data.length || data.length > 32 * 1024 * 1024)
    throw new WeavaError('附件大小需要在 32 MB 以内。');
  const ext = extname(name).toLowerCase();
  if (
    ![
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.avif',
      '.pdf',
      '.txt',
      '.csv',
      '.vtt',
      '.srt',
      '.mp3',
      '.mp4',
      '.webm',
    ].includes(ext)
  )
    throw new WeavaError('不支持这个附件格式。');
  const path = join(site.root, 'media', digest(data).slice(0, 24) + ext);
  if (!existsSync(path)) writeFileSync(path, data);
  return { path, name };
}
export async function prepareMedia(site: Site, data: Buffer, name: string) {
  if (!data.length || data.length > 32 * 1024 * 1024)
    throw new WeavaError('附件大小需要在 32 MB 以内。');
  const hash = digest(data),
    id = hash.slice(0, 24);
  const existing = site.store.get('media', id);
  if (existing && [existing.value.url, ...(existing.value.derivatives ?? []).map((item: any) => item.url)].every((url) => existsSync(inside(site.root, url.slice(1))))) return existing;
  const ext = extname(existing?.value.url ?? name).toLowerCase();
  const image = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext);
  if (!image && !['.pdf', '.txt', '.csv', '.vtt', '.srt', '.mp3', '.mp4', '.webm'].includes(ext))
    throw new WeavaError('不支持这个附件格式。');
  let metadata: any = {};
  if (image) {
    metadata = await sharp(data, { limitInputPixels: 32000000 }).metadata();
    if (!metadata.format || Math.max(metadata.width ?? 0, metadata.height ?? 0) > 12000)
      throw new WeavaError('图片格式或尺寸无效。');
  }
  const file = existing?.value.url?.slice('/media/'.length) ?? id + ext,
    dir = join(site.root, 'media');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), data);
  const derivatives: any[] = [];
  if (image) {
    const optimized = join(dir, 'optimized');
    mkdirSync(optimized, { recursive: true });
    for (const width of [480, 960, 1600]) {
      if ((metadata.width ?? 0) < width && derivatives.length) continue;
      const target = id + '-' + width + '.webp';
      const info = await sharp(data, { limitInputPixels: 32000000 })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(join(optimized, target));
      derivatives.push({
        url: '/media/optimized/' + target,
        width: info.width,
        bytes: statSync(join(optimized, target)).size,
      });
    }
  }
  return {
    id, revision: existing?.revision ?? null,
    value: {
      id,
      name,
      url: '/media/' + file,
      bytes: data.length,
      hash,
      width: metadata.width,
      height: metadata.height,
      derivatives,
      createdAt: now(),
      ...(existing?.value ?? {}),
    },
  };
}
export async function uploadMedia(site: Site, data: Buffer, name: string) {
  const prepared = await prepareMedia(site, data, name);
  const existing = site.store.get('media', prepared.id);
  return site.store.put('media', prepared.id, prepared.value, existing?.revision ?? null, '上传');
}
