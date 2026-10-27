import { join, extname } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { digest, now } from './storage.ts';
import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { load } from 'cheerio';
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
export async function uploadMedia(site: Site, data: Buffer, name: string) {
  if (!data.length || data.length > 32 * 1024 * 1024)
    throw new WeavaError('附件大小需要在 32 MB 以内。');
  const hash = digest(data),
    id = hash.slice(0, 24);
  const existing = site.store.get('media', id);
  if (existing) return existing;
  const ext = extname(name).toLowerCase();
  const image = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext);
  if (!image && !['.pdf', '.txt', '.csv', '.vtt', '.srt', '.mp3', '.mp4', '.webm'].includes(ext))
    throw new WeavaError('不支持这个附件格式。');
  let metadata: any = {};
  if (image) {
    metadata = await sharp(data, { limitInputPixels: 32000000 }).metadata();
    if (!metadata.format || Math.max(metadata.width ?? 0, metadata.height ?? 0) > 12000)
      throw new WeavaError('图片格式或尺寸无效。');
  }
  const file = id + ext,
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
  return site.store.put(
    'media',
    id,
    {
      id,
      name,
      url: '/media/' + file,
      bytes: data.length,
      hash,
      width: metadata.width,
      height: metadata.height,
      derivatives,
      createdAt: now(),
    },
    null,
    '上传',
  );
}
