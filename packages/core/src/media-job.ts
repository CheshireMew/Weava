import { join } from 'node:path';
import { inside } from '../../runtime-common/src/paths.ts';
import type { JobContext } from './job-context.ts';
export async function executeMediaJob({ site, job }: JobContext) {
  const { operation, payload, id } = job;
  if (operation === 'media-variant')
    return (await import('./image-variants.ts')).imageVariant(site, payload);
  if (operation === 'media' && payload.uploadId)
    return (await import('./media-upload.ts')).completeMediaUpload(site, payload.uploadId, id);
  const media = await import('./media.ts');
  if (operation === 'media-edit')
    return media.cropMedia(site, payload.id, payload.revision, payload.crop);
  if (operation === 'media-optimize') return media.optimizeMedia(site, payload.id, id);
  return media.uploadMedia(site, inside(join(site.root, 'media'), payload.path), payload.name);
}
