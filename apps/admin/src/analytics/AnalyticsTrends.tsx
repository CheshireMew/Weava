import { Card } from './Card.tsx';

import { Trend } from './Trend.tsx';

import { analyticsPresentation } from './presentation.tsx';

import type { AnalyticsView } from './types.ts';
export function AnalyticsTrends({ model, section = 'overview' }: { section?: 'overview' | 'sources'; model: Pick<AnalyticsView, 'data' | 'openVisitor'> }) {
  const { data, openVisitor } = model;
  const { dates } = analyticsPresentation(data, openVisitor);

  return (
    <>
      {' '}
      {section === 'overview' && <Card title="流量趋势">
        <Trend
          dates={dates}
          empty={!data.views && !data.previous.views}
          series={[
            {
              name: '浏览量',
              color: 'var(--analytics-purple)',
              values: data.daily.map((d) => d.views),
              total: data.views,
            },
            {
              name: '访客',
              color: 'var(--analytics-blue)',
              values: data.daily.map((d) => d.visitors),
              total: data.visitors,
            },
            {
              name: '上期浏览',
              color: 'var(--analytics-purple)',
              values: data.daily.map((d) => d.previousViews),
              total: data.previous.views,
              dashed: true,
            },
            {
              name: '上期访客',
              color: 'var(--analytics-blue)',
              values: data.daily.map((d) => d.previousVisitors),
              total: data.previous.visitors,
              dashed: true,
            },
          ]}
        />
      </Card>}
      {section === 'sources' && <Card title="搜索与 AI 来源趋势">
        <Trend
          dates={dates}
          empty={!data.engines.length}
          series={data.engines.flatMap((e, i) => {
            const color = [
              'var(--analytics-green)',
              'var(--analytics-blue)',
              'var(--analytics-purple)',
              'var(--analytics-orange)',
            ][i % 4];
            return [
              {
                name: e.name,
                color,
                values: dates.map((day) => e.daily.find((d) => d.date === day)?.views || 0),
              },
              ...(e.previousViews
                ? [
                    {
                      name: e.name + ' 上期',
                      color,
                      dashed: true,
                      values: dates.map(
                        (day) => e.previousDaily.find((d) => d.date === day)?.views || 0,
                      ),
                    },
                  ]
                : []),
            ];
          })}
        />
        <p className="analytics-note">按访问来源统计浏览量；来源被隐藏的访问归入直接 / 未知。</p>
      </Card>}
    </>
  );
}
