import { isUploadFormat, WeavaError } from '@weava/contracts';
import sharp from 'sharp';
import { inside } from '../../runtime-common/src/paths.ts';
import { imageDerivatives } from './media-images.ts';
import type { MediaRepository } from './media-repository.ts';
import type { JobStore } from './job-store.ts';
export interface MediaOptimizationSource {
  root: string;
  media: Pick<MediaRepository, 'get' | 'updateOptimization' | 'transaction'>;
  jobStore: Pick<JobStore, 'latestMediaOptimization' | 'createJob' | 'updateJob' | 'job'>;
}

export function queueMediaOptimization(site: MediaOptimizationSource, id: string) {
  return site.media.transaction(() => {
    const row = site.media.get(id);
    if (
      !row ||
      !isUploadFormat(row.value.url, true) ||
      ['complete', 'skipped'].includes(row.value.optimization?.status)
    )
      return null;
    const previous = site.jobStore.latestMediaOptimization(id);
    if (previous && ['queued', 'running'].includes(previous.status)) return previous;
    site.media.updateOptimization(id, { optimization: { status: 'pending' } });
    const job = site.jobStore.createJob(
      'media-optimize',
      { id },
      'media-optimize:' + id + (previous ? ':' + previous.id : ''),
    );
    return site.jobStore.updateJob(job.id, { managed: true });
  });
}

export async function optimizeMedia(site: MediaOptimizationSource, id: string, jobId?: string) {
  const row = site.media.get(id);
  if (!row) throw new WeavaError('媒体不存在。', 404);
  try {
    const file = inside(site.root, row.value.url.slice(1));
    const metadata = await sharp(file, { limitInputPixels: 32000000 }).metadata();
    const derivatives = await imageDerivatives(
      site.root,
      file,
      id,
      metadata,
      row.value.bytes,
      row.value.derivatives,
    );
    if (jobId && site.jobStore.job(jobId).cancelRequestedAt)
      throw new WeavaError('图片优化已取消，原图仍可使用。');
    return site.media.updateOptimization(id, {
      derivatives,
      optimization: { status: (metadata.pages ?? 1) > 1 ? 'skipped' : 'complete' },
    });
  } catch (error: any) {
    site.media.updateOptimization(id, { optimization: { status: 'failed', error: error.message } });
    throw error;
  }
}
