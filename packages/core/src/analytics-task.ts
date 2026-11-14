import type { Analytics } from './analytics.ts';
import { WeavaError } from '@weava/contracts';
import type { JobContext } from './job-context.ts';
export function queryAnalyticsTask(analytics: Analytics, operation: string, payload: any) {
  const params = new URLSearchParams(payload.query);
  switch (operation) {
    case 'analytics-report':
      return analytics.report(params, payload.timezone);
    case 'analytics-discovery':
      return analytics.discovery(params, payload.timezone);
    case 'analytics-archive-preview':
      return analytics.previewArchive(payload.before);
    case 'analytics-realtime':
      return analytics.realtime(params);
    case 'analytics-visitor':
      return analytics.visitor(payload.id, params, payload.timezone);
    case 'analytics-export':
      return analytics.export(params, payload.timezone);
    default:
      throw new WeavaError('未知统计操作：' + operation);
  }
}
export async function executeAnalyticsJob({ site, job, stats }: JobContext) {
  const analytics = stats
    ? await stats()
    : new (await import('./analytics.ts')).Analytics(site.root);
  try {
    if (job.operation === 'analytics-archive')
      return analytics.archive(job.payload.before, job.payload.review, job.payload.budgetBytes);
    if (job.operation === 'analytics-restore') return analytics.restoreArchive(job.payload.id);
    return queryAnalyticsTask(analytics, job.operation, job.payload);
  } finally {
    if (!stats) analytics.close();
  }
}
