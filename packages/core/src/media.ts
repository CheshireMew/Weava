/** Stable public API; implementation and persistence are owned by media modules. */
import type { MediaRepository } from './media-repository.ts';
import type { Site } from './site.ts';
export { mediaKind } from '@weava/contracts';
export {
  stageMedia,
  validateMediaFile,
  mediaStorageTarget,
  prepareMedia,
  uploadMedia,
  type PrepareMediaOptions,
} from './media-files.ts';
export { cropMedia, type ImageCrop } from './media-crop.ts';
export { imageAttributes, responsiveImages } from './media-display.ts';
export { queueMediaOptimization, optimizeMedia } from './media-optimization.ts';
interface MediaSource {
  media: MediaRepository;
}
export const queryMedia = (site: MediaSource, params: URLSearchParams) => site.media.query(params);
export const mediaGroups = (site: MediaSource) => site.media.groups();
export const mediaRecords = (site: MediaSource) => site.media.list();
export const saveMediaGroup = (
  site: MediaSource,
  ...args: Parameters<MediaRepository['saveGroup']>
) => site.media.saveGroup(...args);
export const moveMedia = (site: MediaSource, ...args: Parameters<MediaRepository['move']>) =>
  site.media.move(...args);
export const saveMediaMetadata = (
  site: MediaSource,
  ...args: Parameters<MediaRepository['saveMetadata']>
) => site.media.saveMetadata(...args);
export const archiveMedia = (site: MediaSource, ...args: Parameters<MediaRepository['archive']>) =>
  site.media.archive(...args);
export const updateMediaOptimization = (
  site: MediaSource,
  ...args: Parameters<MediaRepository['updateOptimization']>
) => site.media.updateOptimization(...args);
export function mediaReferences(site: Pick<Site, 'media' | 'release'>, id: string) {
  const { publishedIds, ...usage } = site.media.usage(id);
  return {
    ...usage,
    published: publishedIds.size
      ? (site.release()?.entries ?? [])
          .filter((entry) => publishedIds.has(entry.id))
          .map(({ id, title, path }) => ({ id, title, path }))
      : [],
  };
}
