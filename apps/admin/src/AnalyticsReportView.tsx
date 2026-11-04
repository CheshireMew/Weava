import { AnalyticsSidebar } from './analytics/AnalyticsSidebar.tsx';
import { AnalyticsTrends } from './analytics/AnalyticsTrends.tsx';
import { AnalyticsAudience } from './analytics/AnalyticsAudience.tsx';
import { AnalyticsGeography } from './analytics/AnalyticsGeography.tsx';
import { AnalyticsActions } from './analytics/AnalyticsActions.tsx';

import { number, duration, change } from './analytics/format.ts';

import type { AnalyticsReport } from '@weava/contracts';
import type { AnalyticsController } from './analytics/useAnalyticsReport.ts';
export function AnalyticsReportView({
  data,
  model,
  openVisitor,
  onError,
}: {
  data: AnalyticsReport;
  model: AnalyticsController;
  openVisitor: (id: string) => void;
  onError: (message: string) => void;
}) {
  const { loading } = model,
    zone = data.range.timezone,
    view = { ...model, data, openVisitor, onError };
  return (
    <div aria-busy={loading}>
      <div className="analytics-range">
        {data.range.start} — {data.range.end}{' '}
        <span>
          {zone} · 对比 {data.range.previousStart} — {data.range.previousEnd}
        </span>
      </div>
      <div className="analytics-metrics">
        {(
          [
            ['views', '浏览量'],
            ['visitors', '访客'],
            ['sessions', '会话'],
            ['clicks', '链接点击'],
          ] as const
        ).map(([key, label]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>{number(data[key])}</strong>
            <small>
              较上一时段 <b>{change(data[key], data.previous[key])}</b>
            </small>
          </article>
        ))}
        <article>
          <span>平均可见停留</span>
          <strong>{duration(data.averageActiveMs)}</strong>
          <small>仅统计页面可见的时间</small>
        </article>
      </div>
      <div className="analytics-dashboard">
        <section className="analytics-main" aria-label="统计报表">
          <AnalyticsTrends model={view} />
          <AnalyticsAudience model={view} />
          <details className="settings-disclosure"><summary>地区详情</summary><AnalyticsGeography model={view} /></details>
          <details className="settings-disclosure"><summary>点击、推广与爬虫详情</summary><AnalyticsActions model={view} /></details>
        </section>
        <AnalyticsSidebar model={view} />
      </div>
    </div>
  );
}
