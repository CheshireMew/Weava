import { Card } from './Card.tsx';
import { DataTable } from './DataTable.tsx';

import { channels, country, dateAt } from './format.ts';
import { analyticsPresentation } from './presentation.tsx';

import type { AnalyticsView } from './types.ts';
export function AnalyticsAudience({
  model,
}: {
  model: Pick<
    AnalyticsView,
    'data' | 'live' | 'path' | 'loadedQuery' | 'liveError' | 'retryLive' | 'openVisitor'
  >;
}) {
  const { data, live, loadedQuery, liveError, retryLive, openVisitor } = model;
  const { zone, pageLink, visitorColumns, pageColumns } = analyticsPresentation(data, openVisitor);

  return (
    <>
      {' '}
      <Card title="页面排行">
        <DataTable rows={data.pages} columns={pageColumns} />
      </Card>
      <Card title="访问来源">
        <DataTable
          rows={data.sources}
          columns={[
            {
              key: 'name',
              label: '来源',
              render: (v) => (
                <span className="analytics-visitor-device">
                  {v.name}
                  {v.host && v.host !== v.name && <small>{v.host}</small>}
                </span>
              ),
            },
            {
              key: 'channel',
              label: '渠道',
              render: (v) => channels[v.channel] || v.channel,
            },
            { key: 'sessions', label: '会话', numeric: true },
            { key: 'visitors', label: '访客', numeric: true },
            { key: 'views', label: '浏览', numeric: true },
          ]}
        />
      </Card>
      <details className="settings-disclosure"><summary>访客详情</summary><Card title="最活跃访客">
        <DataTable rows={data.activeVisitors} columns={visitorColumns} size={10} />
      </Card>
      <Card title="最新访客">
        <DataTable rows={data.recentVisitors} columns={visitorColumns} size={10} />
        {data.recentVisitors.length === 100 && (
          <p className="analytics-note">展示所选范围内最近 100 位访客。</p>
        )}
      </Card>
      <Card
        title="当前在线"
        action={
          <span className="analytics-live-count">
            <i />
            {live?.count || 0}
          </span>
        }
      >
        {liveError && (
          <p role="status" className="analytics-note">
            实时数据更新失败，保留 {live ? dateAt(live.at, zone) : '此前'} 的记录。
            <button className="analytics-text-button" onClick={() => retryLive.current()}>
              重试实时统计
            </button>
          </p>
        )}
        <DataTable
          rows={live?.visitors || []}
          empty="当前没有在线访客。"
          columns={[
            {
              key: 'id',
              label: '访客',
              render: (v) => (
                <button className="analytics-text-button" onClick={() => openVisitor(v.id)}>
                  {v.id.slice(0, 8)}
                </button>
              ),
            },
            { key: 'country', label: '地区', render: (v) => country(v.country) },
            { key: 'browser', label: '浏览器' },
            { key: 'path', label: '当前页面', render: (v) => pageLink(v.path) },
            { key: 'lastSeen', label: '最后活动', render: (v) => dateAt(v.lastSeen, zone) },
          ]}
        />
        <p className="analytics-note">
          最近 5 分钟收到可见页面心跳的访客，每 15 秒刷新。此处按当前时间统计
          {new URLSearchParams(loadedQuery).get('path') ? '，页面路径筛选生效' : '全站'}。
        </p>
      </Card>
    </details></>
  );
}
