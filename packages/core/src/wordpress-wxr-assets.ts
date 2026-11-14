import { mediaUploadMaxBytes, WeavaError } from '@weava/contracts';
import { existsSync, statSync } from 'node:fs';
import { inside } from '../../runtime-common/src/paths.ts';
import { downloadPublicAttachment as attachmentBytes } from './attachment-download.ts';
import { prepareMedia } from './media-files.ts';
import { pathWithin } from './paths.ts';
import type { Site } from './site.ts';
import type { convertWxr } from './wordpress-wxr-conversion.ts';
import type { WxrOptions } from './wordpress-wxr-options.ts';
function localAttachment(directory: string, url: URL) {
  const path = inside(directory, decodeURIComponent(url.pathname).replace(/^\//, ''));
  if (!pathWithin(directory, path)) throw new WeavaError('附件文件超出指定目录，请检查目录链接。');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > mediaUploadMaxBytes)
    throw new WeavaError('附件需要是 32 MB 以内的普通文件。');
  return path;
}
export async function prepareWxrAttachments(
  site: Site,
  initial: ReturnType<typeof convertWxr>,
  options: WxrOptions,
  progress: (message: string) => void,
) {
  const prepared: Awaited<ReturnType<typeof prepareMedia>>[] = [],
    mediaMap: Record<string, string> = {};
  let reusedMedia = 0;
  const prepare = async (asset: typeof initial.attachments[number], index: number) => {
      progress(`正在导入附件 ${index + 1} / ${initial.attachments.length}：${asset.name}`);
      const url = new URL(asset.url, initial.report.source);
      if (!['http:', 'https:'].includes(url.protocol))
        throw new WeavaError('附件网址无效：' + asset.url);
      const existing = initial.report.attachments.find((item) => item.id === asset.id)?.local;
      if (existing && existsSync(inside(site.root, existing.slice(1)))) {
        mediaMap[asset.url] = existing;
        mediaMap[url.pathname] = existing;
        reusedMedia++;
        return;
      }
      const bytes = options.mediaDirectory
        ? localAttachment(options.mediaDirectory, url)
        : await attachmentBytes(url.href);
      const row = await prepareMedia(site, bytes, asset.name, { optimize: false });
      prepared.push({
        ...row,
        value: {
          ...row.value,
          alt: row.value.alt ?? asset.alt,
          caption: row.value.caption ?? asset.caption,
        },
      });
      mediaMap[asset.url] = row.value.url;
      mediaMap[url.href] = row.value.url;
      mediaMap[url.pathname] = row.value.url;
  };
  if (options.downloadMedia || options.mediaDirectory) {
    let next = 0, failure: unknown;
    await Promise.all(Array.from({ length: Math.min(3, initial.attachments.length) }, async () => {
      for (;;) { const index = next++; if (failure || index >= initial.attachments.length) return; try { await prepare(initial.attachments[index], index); } catch (error) { failure = error; return; } }
    }));
    if(failure)throw failure;
  }
  return { prepared, mediaMap, reusedMedia };
}
