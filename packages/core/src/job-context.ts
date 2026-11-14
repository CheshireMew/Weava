import type { Job } from '@weava/contracts';
import type { Site } from './site.ts';
import type { ExtensionManager } from './extension-manager.ts';
import type { Analytics } from './analytics.ts';
export interface JobContext {
  site: Site;
  job: Job;
  content: () => Promise<{ manager: ExtensionManager }>;
  stats?: () => Promise<Analytics>;
  imports?: () => Promise<typeof import('./import-sources.ts')>;
}
export type JobHandler = (context: JobContext) => Promise<unknown>;
