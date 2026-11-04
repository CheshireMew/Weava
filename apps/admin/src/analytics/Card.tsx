import { createContext, useContext, type ReactNode } from 'react';

export const AnalyticsExportContext = createContext<string | null>(null);
const datasets: Record<string, string> = { '流量趋势':'daily', '页面排行':'pages', '访问来源':'sources', '国家 / 地区':'countries', '浏览器':'browsers', '操作系统':'os', '设备类型':'devices', '设备型号':'models', '最新访客':'visitors', '链接点击':'links', '关键动作':'actions', '推广链接':'campaigns', '爬虫请求':'crawlers', '累计浏览':'lifetime', '全球访客分布':'countries' };
export function Card({
  title,
  children,
  action,
  className = '',
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const query = useContext(AnalyticsExportContext), dataset = datasets[title];
  return (
    <section className={'analytics-card ' + className}>
      <div className="analytics-card-title">
        <h2>{title}</h2>
        {action}{dataset && query !== null && <a className="analytics-text-button" aria-label={'导出' + title} href={'/api/admin/v1/analytics/export?' + query + '&dataset=' + dataset}>导出</a>}
      </div>
      {children}
    </section>
  );
}
