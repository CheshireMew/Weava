import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
export type PublicationSite = Pick<
  Site,
  | 'store'
  | 'root'
  | 'settings'
  | 'release'
  | 'terms'
  | 'fieldWidgets'
  | 'blockRenderers'
  | 'publicationValidators'
  | 'validateBlocks'
  | 'validateReleaseExtensions'
  | 'updateJob'
>;
/** Only conflicts whose prerequisite can be refreshed automatically may stay
 * scheduled. A generic 409 (for example a stale withdrawal) needs user action. */
export class RetryablePublicationConflict extends WeavaError {
  constructor(message: string) {
    super(message, 409);
  }
}
export type WatchPublicationInput = (scope: string, ids?: string[]) => void;
