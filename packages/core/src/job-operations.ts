import type { JobHandler } from './job-context.ts';
import { WeavaError } from '@weava/contracts';
const publication: JobHandler = async (context) =>
  (await import('./publication-job.ts')).executePublicationJob(context);
const media: JobHandler = async (context) =>
  (await import('./media-job.ts')).executeMediaJob(context);
const importing: JobHandler = async (context) =>
  (await import('./import-job.ts')).executeImportJob(context);
const maintenance: JobHandler = async (context) =>
  (await import('./maintenance-job.ts')).executeMaintenanceJob(context);
const analytics: JobHandler = async (context) =>
  (await import('./analytics-task.ts')).executeAnalyticsJob(context);
type Lane = 'publication' | 'background' | 'command';
const operations: Record<string, { lane: Lane; execute: JobHandler }> = {};
for (const operation of ['publish', 'withdraw', 'entry-delete'])
  operations[operation] = { lane: 'publication', execute: publication };
for (const operation of ['schedule-create', 'plan-save'])
  operations[operation] = { lane: 'command', execute: publication };
for (const operation of ['media-edit', 'media-variant'])
  operations[operation] = { lane: 'command', execute: media };
for (const operation of ['media', 'media-optimize'])
  operations[operation] = { lane: 'background', execute: media };
for (const operation of [
  'preflight-wxr',
  'import-wxr',
  'import-source',
  'import-json',
  'markdown-export',
  'markdown-preview',
  'markdown-import',
])
  operations[operation] = { lane: 'background', execute: importing };
for (const operation of [
  'backup',
  'verify',
  'archive-history',
  'restore-history',
  'seo-audit',
  'storage-scan',
])
  operations[operation] = { lane: 'background', execute: maintenance };
for (const operation of ['analytics-archive', 'analytics-restore'])
  operations[operation] = { lane: 'background', execute: analytics };
export const jobLane = (operation: string): Lane | 'isolated' =>
  operations[operation]?.lane ?? 'isolated';
export const operationsInLane = (lane: Lane) =>
  Object.keys(operations).filter((operation) => operations[operation].lane === lane);
export function jobHandler(operation: string): JobHandler {
  if (operations[operation]) return operations[operation].execute;
  if (operation.startsWith('analytics-')) return analytics;
  if (operation.startsWith('website:'))
    return async (context) => (await import('./website-job.ts')).executeWebsiteJob(context);
  throw new WeavaError('未知任务：' + operation);
}
