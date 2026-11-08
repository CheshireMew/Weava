import { digest } from '../../runtime-common/src/identity.ts';
import type { ImportOptions } from './exchange.ts';
export interface WxrOptions extends ImportOptions {
  settings?: boolean;
  downloadMedia?: boolean;
  mediaDirectory?: string;
  comments?: boolean;
  review?: { fingerprint: string; revision: number; releaseId: string | null; options: string };
}
export const optionKey = (options: WxrOptions) =>
  digest({
    settings: !!options.settings,
    downloadMedia: !!options.downloadMedia,
    mediaDirectory: options.mediaDirectory ?? null,
    comments: options.comments !== false,
    mode: options.mode ?? 'create',
    revisions: options.revisions ?? {},
  });
