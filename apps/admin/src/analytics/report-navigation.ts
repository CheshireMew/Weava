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
export const sections = [['overview', '概览'], ['sources', '来源'], ['visitors', '访客'], ['devices', '设备'], ['actions', '行为']] as const;
export type AnalyticsSection = typeof sections[number][0];
export function reportSection(report: ReportName | null): AnalyticsSection {
  if (report === 'sources' || report === 'countries') return 'sources';
  if (report === 'active' || report === 'visitors' || report === 'realtime') return 'visitors';
  if (report === 'browsers' || report === 'os' || report === 'devices' || report === 'models') return 'devices';
  return report === 'actions' ? 'actions' : 'overview';
}
export const filterKeys = ['channel', 'country', 'browser', 'os', 'device', 'model'] as const;
export function reportLocation(search: string) {
  const p = new URLSearchParams(search), key = p.get('report');
  const report = key && Object.hasOwn(reports, key) ? key as ReportName : null;
  const query = new URLSearchParams();
  for (const key of ['start', 'end', 'path', ...filterKeys]) if (p.get(key)) query.set(key, p.get(key)!);
  const selected = p.get('section');
  const section = sections.some(([key]) => key === selected) ? selected as AnalyticsSection : reportSection(report);
  return { report, section, query: query.toString() };
}
export function reportUrl(report: ReportName | null, query = '', section = reportSection(report)) {
  const p = new URLSearchParams({ panel: 'analytics' });
  if (section !== 'overview') p.set('section', section);
  if (report) p.set('report', report);
  for (const [key, value] of new URLSearchParams(query)) p.set(key, value);
  return window.location.pathname + '?' + p;
}
