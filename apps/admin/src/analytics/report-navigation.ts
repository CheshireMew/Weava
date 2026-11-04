export const reports = {
  traffic: { title: '流量趋势', dataset: 'daily' },
  sources: { title: '访问来源', dataset: 'sources' },
  pages: { title: '页面排行', dataset: 'pages' },
  active: { title: '最活跃访客', dataset: '' },
  visitors: { title: '最新访客', dataset: 'visitors' },
  realtime: { title: '当前在线', dataset: '' },
  countries: { title: '国家 / 地区', dataset: 'countries' },
  browsers: { title: '浏览器', dataset: 'browsers' },
  os: { title: '操作系统', dataset: 'os' },
  devices: { title: '设备类型', dataset: 'devices' },
  models: { title: '设备型号', dataset: 'models' },
  actions: { title: '链接与行为', dataset: 'links' },
} as const;
export type ReportName = keyof typeof reports;
export const filterKeys = ['channel', 'country', 'browser', 'os', 'device', 'model'] as const;
export function reportLocation(search: string) {
  const p = new URLSearchParams(search), key = p.get('report');
  const report = key && Object.hasOwn(reports, key) ? key as ReportName : null;
  const query = new URLSearchParams();
  for (const key of ['start', 'end', 'path', ...filterKeys]) if (p.get(key)) query.set(key, p.get(key)!);
  return { report, query: query.toString() };
}
export function reportUrl(report: ReportName | null, query = '') {
  const p = new URLSearchParams({ panel: 'analytics' });
  if (report) {
    p.set('report', report);
    for (const [key, value] of new URLSearchParams(query)) p.set(key, value);
  }
  return window.location.pathname + '?' + p;
}
