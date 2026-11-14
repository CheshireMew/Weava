import {
  isUploadFormat,
  mediaUploadMaxBytes,
  mediaUploadLimit,
  WeavaError,
} from '@weava/contracts';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
  constants,
} from 'node:fs';
import { copyFile, rename } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { digest, now } from '../../runtime-common/src/identity.ts';
import { inside } from '../../runtime-common/src/paths.ts';
import { assertUploadSize, uploadLimits, type UploadPolicySource } from './media-upload-policy.ts';
import { digestFile } from './file-io.ts';
import { validateMediaFormat } from './media-format.ts';
import { imageDerivatives } from './media-images.ts';
import type { MediaRepository } from './media-repository.ts';
export interface MediaFileSource extends UploadPolicySource {
  root: string;
  media: Pick<MediaRepository, 'get' | 'put'>;
}

export function stageMedia(site: MediaFileSource, data: Buffer, name: string) {
  assertUploadSize(site, name, data.length);
  const ext = extname(name).toLowerCase();
  if (!isUploadFormat(name)) throw new WeavaError('不支持这个附件格式。');
  validateMediaFormat(data, ext);
  const path = join(site.root, 'media', digest(data).slice(0, 24) + ext);
  if (!existsSync(path)) writeFileSync(path, data);
  return { path, name };
}
export function validateMediaFile(file: string, name: string, maximum = mediaUploadMaxBytes) {
  const size = statSync(file).size;
  if (!size || size > maximum)
    throw new WeavaError('附件大小需要在 ' + maximum / 1048576 + ' MB 以内。');
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
export interface PrepareMediaOptions {
  hash?: string;
  validatedSize?: number;
  move?: boolean;
  optimize?: boolean;
}
/** One destination rule for new media, deduplication and interrupted uploads. */
export function mediaStorageTarget(site: MediaFileSource, hash: string, name: string) {
  const id = hash.slice(0, 24),
    existing = site.media.get(id);
  const ext = extname(existing?.value.url ?? name).toLowerCase();
  if (!isUploadFormat(ext)) throw new WeavaError('不支持这个附件格式。');
  const file = existing?.value.url?.slice('/media/'.length) ?? id + ext;
  return { id, existing, ext, file, path: 'media/' + file };
}
export async function prepareMedia(
  site: MediaFileSource,
  data: Buffer | string,
  name: string,
  options: PrepareMediaOptions = {},
) {
  const size =
    options.validatedSize ??
    (typeof data === 'string'
      ? validateMediaFile(data, name, mediaUploadLimit(name, uploadLimits(site)))
      : data.length);
  assertUploadSize(site, name, size);
  if (typeof data !== 'string') validateMediaFormat(data, extname(name).toLowerCase());
  const hash = options.hash ?? (typeof data === 'string' ? digestFile(data) : digest(data));
  const { id, existing, ext, file } = mediaStorageTarget(site, hash, name);
  if (
    existing &&
    [
      existing.value.url,
      ...(options.optimize === false ? [] : (existing.value.derivatives ?? [])).map(
        (item: any) => item.url,
      ),
    ].every((url) => existsSync(inside(site.root, url.slice(1))))
  )
    return existing;
  const image = isUploadFormat(ext, true);
  const dir = join(site.root, 'media'),
    destination = join(dir, file);
  mkdirSync(dir, { recursive: true });
  if (typeof data === 'string') {
    if (data !== destination && !existsSync(destination)) {
      try {
        await (options.move
          ? rename(data, destination)
          : copyFile(data, destination, constants.COPYFILE_EXCL));
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } else if (!existsSync(destination)) {
    try {
      writeFileSync(destination, data, { flag: 'wx' });
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  // Native image readers may retain file handles on Windows. Read the durable
  // copy so the upload's temporary file can be released before committing it.
  const imageInput = typeof data === 'string' ? destination : data;
  let metadata: any = {};
  if (image) {
    metadata = await sharp(imageInput, { limitInputPixels: 32000000 }).metadata();
    if (!metadata.format || Math.max(metadata.width ?? 0, metadata.height ?? 0) > 12000)
      throw new WeavaError('图片格式或尺寸无效。');
  }
  const derivatives =
    image && options.optimize !== false
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
      ...(image && options.optimize === false
        ? { optimization: { status: (metadata.pages ?? 1) > 1 ? 'skipped' : 'pending' } }
        : {}),
      createdAt: now(),
      ...(existing?.value ?? {}),
    },
  };
}
export async function uploadMedia(site: MediaFileSource, data: Buffer | string, name: string) {
  const prepared = await prepareMedia(site, data, name);
  const existing = site.media.get(prepared.id);
  return site.media.put(prepared.id, prepared.value, existing?.revision ?? null, '上传');
}
