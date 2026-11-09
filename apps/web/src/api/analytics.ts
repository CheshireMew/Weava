import type { ApiServices, AdminHandlers } from './types.ts';
export function analyticsHandlers(services: Pick<ApiServices, 'site' | 'analytics' | 'reports'>) {
  const { site, analytics, reports } = services;

  return {
    analytics: async ({}, context) => {
      const { url } = context;
      const value=await reports.read('analytics-report', {
          query: url.searchParams.toString(),
          timezone: site.settings().value.timezone,
        });
      const section=url.searchParams.get('section')??'all';
      const report={...value,lifetimePages:['all','actions'].includes(section)?value.lifetimePages:[]};
      const paths=new Set<string>();
      for(const key of ['pages','links','crawlers','lifetimePages','recentVisitors','activeVisitors'])for(const row of report[key]??[])for(const field of ['path','entryPath','exitPath'])if(row[field])paths.add(row[field]);
      for(const row of report.realtime?.visitors??[])if(row.path)paths.add(row.path);
      return {...report,
        pageTitles: Object.fromEntries(
          site.visibleRelease()?.entries.filter(entry=>paths.has(entry.path)).map((e) => [e.path, e.title]) || [],
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
