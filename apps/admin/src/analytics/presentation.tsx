import type { AnalyticsReport, AnalyticsVisitor } from '@weava/contracts';

import { country, devices, dateAt, duration } from './format.ts';
import type { Column } from './DataTable.tsx';
export function analyticsPresentation(
  data: AnalyticsReport | null,
  openVisitor: (id: string) => void,
) {
  const zone = data?.range.timezone || 'Asia/Shanghai';
  const pageLabel = (p: string) => {
    if (data?.pageTitles?.[p]) return data.pageTitles[p];
    try {
      return decodeURI(p);
    } catch {
      return p;
    }
  };
  const pageLink = (p: string) => (
    <a href={p} target="_blank" rel="noreferrer" className="analytics-page-link" title={pageLabel(p) + '\n' + p}>
      <span>{pageLabel(p)}</span>
    </a>
  );
  const visitorColumns: Column[] = [
    {
      key: 'id',
      label: '访客',
      render: (v: AnalyticsVisitor) => (
        <button className="analytics-text-button analytics-visitor-id" onClick={() => openVisitor(v.id)} title={v.id}>
          {v.id.slice(0, 8)}
        </button>
      ),
    },
    { key: 'views', label: '浏览', numeric: true },
    {
      key: 'country',
      label: '地区 / 设备',
      render: (v: AnalyticsVisitor) => (
        <span className="analytics-visitor-device">
          {country(v.country)}
          <small>
            {v.browser} · {v.os} · {devices[v.device] || v.device}
          </small>
        </span>
      ),
    },
    { key: 'source', label: '来源' },
    { key: 'entryPath', label: '入口', render: (v) => pageLink(v.entryPath) },
    { key: 'exitPath', label: '最后页面', render: (v) => pageLink(v.exitPath) },
    { key: 'lastSeen', label: '最后访问', render: (v) => dateAt(v.lastSeen, zone) },
  ];
  const pageColumns: Column[] = [
    { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
    { key: 'views', label: '浏览', numeric: true },
    { key: 'visitors', label: '访客', numeric: true },
    { key: 'entries', label: '进入', numeric: true },
    { key: 'exits', label: '退出', numeric: true },
    {
      key: 'averageActiveMs',
      label: '平均停留',
      numeric: true,
      render: (v) => duration(v.averageActiveMs),
    },
  ];
  const dates = data?.daily.map((d) => d.date) || [];
  return { zone, pageLink, visitorColumns, pageColumns, dates };
}
