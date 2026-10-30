import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { imageSpecSchema, imagePresetSchema, WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { digest, inside, now } from './storage.ts';
export const imagePresets = (site: Site) => site.store.list('image-preset');
export function saveImagePreset(site: Site, value: unknown, revision: number | null) {
  const preset = imagePresetSchema.parse(value); return site.store.put('image-preset', preset.id, preset, revision);
}
export async function imageVariant(site: Site, input: { id: string; revision: number; presetId?: string; spec?: unknown }) {
  const media = site.store.get('media', input.id);
  if (!media || media.revision !== input.revision) throw new WeavaError('媒体已变化，请重新载入。', 409);
  const preset = input.presetId ? site.store.get('image-preset', input.presetId)?.value : null;
  if (input.presetId && (!preset || preset.archived)) throw new WeavaError('图片规格不存在或已归档。');
  const spec = imageSpecSchema.parse(input.presetId ? preset.spec : input.spec);
  const bytes = readFileSync(inside(site.root, media.value.url.slice(1)));
  const key = digest({ source: digest(bytes), spec, focalPoint: media.value.focalPoint ?? { x: 50, y: 50 }, version: 1 });
  const url = '/media/optimized/variant-' + key + '.' + spec.format, path = inside(site.root, url.slice(1));
  const current = site.store.get('media-variant', key);
  if (current && existsSync(path)) return current;
  const rotated = await sharp(bytes, { limitInputPixels: 32000000 }).rotate().png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  if (!metadata.width || !metadata.height) throw new WeavaError('只能为图片生成规格。');
  let image = sharp(rotated);
  if (spec.fit === 'cover' && spec.height) {
    const ratio = spec.width / spec.height;
    const width = Math.min(metadata.width, Math.max(1, Math.round(metadata.height * ratio)));
    const height = Math.min(metadata.height, Math.max(1, Math.round(metadata.width / ratio)));
    const focal = media.value.focalPoint ?? { x: 50, y: 50 };
    const left = Math.max(0, Math.min(metadata.width - width, Math.round(metadata.width * focal.x / 100 - width / 2)));
    const top = Math.max(0, Math.min(metadata.height - height, Math.round(metadata.height * focal.y / 100 - height / 2)));
    image = image.extract({ left, top, width, height });
  }
  mkdirSync(join(site.root, 'media', 'optimized'), { recursive: true });
  const info = await image.resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true }).toFormat(spec.format, { quality: spec.quality }).toFile(path);
  if (site.store.get('media', input.id)?.revision !== input.revision) throw new WeavaError('生成期间媒体已变化，请重新生成。', 409);
  return site.store.raw.transaction(() => {
    const existing = site.store.get('media-variant', key);
    if (existing) return existing;
    return site.store.put('media-variant', key, { id: key, parentId: input.id, url, width: info.width, height: info.height, bytes: statSync(path).size, spec, focalPoint: media.value.focalPoint ?? { x: 50, y: 50 }, createdAt: now() }, null, '生成图片规格');
  }).immediate();
}
