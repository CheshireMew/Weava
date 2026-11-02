import type { ApiServices, AdminHandlers } from './types.ts';
export function analyticsHandlers(services: Pick<ApiServices, 'site' | 'analytics' | 'reports'>) {
  const { site, analytics, reports } = services;

  return {
    analytics: async ({}, context) => {
      const { url } = context;
      return {
        ...(await reports.read('analytics-report', {
          query: url.searchParams.toString(),
          timezone: site.settings().value.timezone,
        })),
        pageTitles: Object.fromEntries(
          site.visibleRelease()?.entries.map((e) => [e.path, e.title]) || [],
        ),
      };
    },
    realtime: async ({}, context) => {
      const { url } = context;
      return await reports.read('analytics-realtime', { query: url.searchParams.toString() });
    },
    visitor: async ({}, context) => {
      const { url } = context;
      return await reports.read('analytics-visitor', {
        id: url.searchParams.get('id') || '',
        query: url.searchParams.toString(),
        timezone: site.settings().value.timezone,
      });
    },
    geo: async () => {
      return analytics.geo.status();
    },
    updateGeo: async () => {
      void analytics.geo.update().catch(() => {});
      return analytics.geo.status();
    },
    exportAnalytics: async ({}, context) => {
      const { url } = context;
      if (!url.searchParams.has('dataset') && url.searchParams.has('group'))
        url.searchParams.set('dataset', url.searchParams.get('group')!);
      return reports.read('analytics-export', {
        query: url.searchParams.toString(),
        timezone: site.settings().value.timezone,
      });
    },
  } satisfies Pick<
    AdminHandlers,
    'analytics' | 'realtime' | 'visitor' | 'geo' | 'updateGeo' | 'exportAnalytics'
  >;
}
