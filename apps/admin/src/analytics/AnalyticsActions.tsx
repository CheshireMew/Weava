import { Card } from './Card.tsx';
import { DataTable } from './DataTable.tsx';

import { number } from './format.ts';
import { analyticsPresentation } from './presentation.tsx';

import type { AnalyticsView } from './types.ts';
export function AnalyticsActions({
  model,
}: {
  model: Pick<AnalyticsView, 'data' | 'path' | 'openVisitor'>;
}) {
  const { data, openVisitor } = model;
  const { pageLink } = analyticsPresentation(data, openVisitor);
  const byAgent = new Map<string, { requests: number; pages: Set<string> }>();
  for (const row of data.crawlers) {
    const totals = byAgent.get(row.agent) ?? { requests: 0, pages: new Set<string>() };
    totals.requests += row.requests;
    if (row.status === 200 || row.status === 304) totals.pages.add(row.path);
    byAgent.set(row.agent, totals);
  }
  const crawlerSummary = [...byAgent].map(([agent, totals]) => ({
    agent, requests: totals.requests, pages: totals.pages.size,
  })).sort((a, b) => b.requests - a.requests || a.agent.localeCompare(b.agent));

  return (
    <>
      {' '}
      <Card title="链接点击" dateRange="select">
        <DataTable
          rows={data.links}
          columns={[
            { key: 'label', label: '链接文字' },
            { key: 'path', label: '所在页面', render: (v) => pageLink(v.path) },
            {
              key: 'url',
              label: '目标',
              render: (v) => (
                <span className="analytics-url" title={v.url}>
                  {v.url}
                </span>
              ),
            },
            {
              key: 'zone',
              label: '位置',
              render: (v) =>
                (({ header: '页头', body: '正文', footer: '页尾' }) as Record<string, string>)[
                  v.zone
                ] || v.zone,
            },
            { key: 'clicks', label: '点击', numeric: true },
          ]}
        />
      </Card>
      <Card title="关键动作" dateRange>
        <DataTable
          rows={data.actions}
          columns={[
            { key: 'name', label: '动作' },
            { key: 'count', label: '次数', numeric: true },
          ]}
        />
      </Card>
      {data.campaigns.length > 0 && (
        <Card title="推广链接" dateRange>
          <DataTable
            rows={data.campaigns}
            columns={[
              { key: 'source', label: '来源' },
              { key: 'medium', label: '媒介' },
              { key: 'campaign', label: '活动' },
              { key: 'sessions', label: '会话', numeric: true },
              { key: 'views', label: '浏览', numeric: true },
            ]}
          />
        </Card>
      )}
      <Card title="爬虫请求" dateRange>
        <DataTable
          rows={crawlerSummary}
          columns={[
            { key: 'agent', label: '声明身份' },
            { key: 'pages', label: '成功抓取页面', numeric: true },
            { key: 'requests', label: '请求次数', numeric: true },
          ]}
        />
        {data.crawlers.length > 0 && <details>
          <summary>按页面查看</summary>
          <DataTable
            rows={data.crawlers}
            columns={[
              { key: 'agent', label: '声明身份' },
              { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
              { key: 'status', label: '状态' },
              { key: 'requests', label: '请求次数', numeric: true },
            ]}
          />
        </details>}
        <p className="analytics-note">
          按请求声明的身份统计到达本站的页面抓取。同一页面反复抓取只计一个页面。
        </p>
      </Card>
      {data.historicalViews > 0 && (
        <Card title="累计浏览">
          <p className="analytics-note">
            共 {number(data.lifetimeViews)} 次，其中迁移历史浏览 {number(data.historicalViews)}{' '}
            次。历史总数没有访问明细，不计入日期趋势、地区和设备分布。
          </p>
          <DataTable
            rows={data.lifetimePages}
            columns={[
              { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
              { key: 'views', label: '累计浏览', numeric: true },
              { key: 'historicalViews', label: '迁移历史', numeric: true },
              { key: 'recordedViews', label: '新记录', numeric: true },
            ]}
          />
        </Card>
      )}
      {data.legacySources.length > 0 && (
        <p className="analytics-note">
          另保留 {data.legacySources.length} 份迁移前统计档案，存放在站点 imports 目录。
        </p>
      )}
    </>
  );
}
