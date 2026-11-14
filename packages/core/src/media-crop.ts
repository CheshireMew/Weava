import { mediaKind, WeavaError } from '@weava/contracts';
import sharp from 'sharp';
import { inside } from '../../runtime-common/src/paths.ts';
import { prepareMedia, type MediaFileSource } from './media-files.ts';
import { queueMediaOptimization, type MediaOptimizationSource } from './media-optimization.ts';

export interface ImageCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}
export async function cropMedia(
  site: MediaFileSource & MediaOptimizationSource,
  id: string,
  revision: number,
  crop: ImageCrop,
) {
  const original = site.media.get(id);
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
  const source = inside(site.root, original.value.url.slice(1));
  const metadata = await sharp(source, { limitInputPixels: 32000000 }).metadata();
  const dimensions = metadata.autoOrient ?? metadata;
  const left = Math.floor((dimensions.width! * crop.left) / 100),
    top = Math.floor((dimensions.height! * crop.top) / 100);
  const width = Math.min(
    dimensions.width! - left,
    Math.max(1, Math.round((dimensions.width! * crop.width) / 100)),
  );
  const height = Math.min(
    dimensions.height! - top,
    Math.max(1, Math.round((dimensions.height! * crop.height) / 100)),
  );
  const cropped = await sharp(source, { limitInputPixels: 32000000 })
    .rotate()
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const prepared = await prepareMedia(
    site,
    cropped,
    original.value.name.replace(/\.[^.]+$/, '') + '-crop.png',
    { optimize: false },
  );
  const existing = site.media.get(prepared.id);
  if (existing) {
    queueMediaOptimization(site, existing.id);
    return existing;
  }
  const saved = site.media.put(
    prepared.id,
    {
      ...prepared.value,
      alt: original.value.alt ?? '',
      caption: original.value.caption ?? '',
      parentId: original.id,
      crop,
      groupId: original.value.groupId ?? null,
    },
    null,
    '裁切副本',
  );
  queueMediaOptimization(site, saved.id);
  return saved;
}
