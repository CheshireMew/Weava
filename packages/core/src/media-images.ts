import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { inside } from './storage.ts';

interface Derivative { url: string; width: number; bytes: number }

/** Display copies belong to one media record; the referenced source stays intact. */
export async function imageDerivatives(root: string, input: Buffer | string, id: string, metadata: Metadata, sourceBytes: number, previous: Derivative[] = []) {
  // A single-frame conversion would silently turn an animation into a still image.
  if ((metadata.pages ?? 1) > 1) return [];
  const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
  if (!sourceWidth) return [];
  const widths = [...new Set([480, 960, 1600].map(width => Math.min(width, sourceWidth)))];
  const derivatives: Derivative[] = [];
  for (const width of widths) {
    const old = previous.find(item => item.width === width && item.bytes < sourceBytes);
    if (old && existsSync(inside(root, old.url.slice(1))) && statSync(inside(root, old.url.slice(1))).size === old.bytes) {
      derivatives.push(old);
      continue;
    }
    const { data, info } = await sharp(input, { limitInputPixels: 32000000 }).rotate()
      .resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    if (data.length >= sourceBytes) continue;
    const dir = join(root, 'media', 'optimized'), name = id + '-' + width + '.webp';
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), data);
    derivatives.push({ url: '/media/optimized/' + name, width: info.width, bytes: data.length });
  }
  return derivatives;
}
