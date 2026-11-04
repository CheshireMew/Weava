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

  return (
    <>
      {' '}
      <Card title="链接点击" dateRange>
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
          rows={data.crawlers}
          columns={[
            { key: 'agent', label: '声明身份' },
            { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
            { key: 'status', label: '状态' },
            { key: 'requests', label: '请求', numeric: true },
          ]}
        />
        <p className="analytics-note">
          按 User-Agent 声明分类，单独记录，不计入访客浏览；不代表 AI 回答引用。
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
