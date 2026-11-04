import { Download, RefreshCw, X } from 'lucide-react';

import { channels, devices, country } from './format.ts';

import type { AnalyticsController } from './useAnalyticsReport.ts';

export function AnalyticsControls({ model }: { model: AnalyticsController }) {
  const {
    data,
    start,
    end,
    path,
    filters,
    loadedQuery,
    loading,
    error,
    exportType,
    setStart,
    setEnd,
    setFilters,
    setApplied,
    setExportType,
    load,
    apply,
    filter,
    preset,
  } = model;
  const exportUrl = '/api/admin/v1/analytics/export?' + loadedQuery + '&dataset=' + exportType;
  const canExport = !!data && !loading && !error;
  return (
    <>
      {' '}
      <div className="panel-title">
        <h1>访问统计</h1>
        <div className="analytics-actions">
          <button disabled={loading} onClick={() => load()} aria-label="刷新统计">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>
      <form
        className="analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="analytics-presets">
          {[
            [1, 0, '今天'],
            [1, -1, '昨天'],
            [7, 0, '近 7 天'],
            [30, 0, '近 30 天'],
            [90, 0, '近 90 天'],
          ].map(([days, offset, label]) => (
            <button key={label} type="button" onClick={() => preset(Number(days), Number(offset))}>
              {label}
            </button>
          ))}
        </div>
        <div className="analytics-date-inputs">
          <input
            aria-label="开始日期"
            required
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <span>至</span>
          <input
            aria-label="结束日期"
            required
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <select
            aria-label="来源筛选"
            value={filters.channel || ''}
            onChange={(e) => filter('channel', e.target.value)}
          >
            <option value="">全部来源</option>
            {Object.entries(channels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loading}>
            查询
          </button>
        </div>
        {Object.entries(filters).length > 0 && (
          <div className="analytics-filter-tags">
            {Object.entries(filters).map(([key, value]) => (
              <button key={key} type="button" onClick={() => filter(key, '')}>
                {key === 'country'
                  ? country(value)
                  : key === 'channel'
                    ? channels[value]
                    : key === 'device'
                      ? devices[value]
                      : value}
                <X size={13} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setApplied(
                  new URLSearchParams({
                    ...(start ? { start } : {}),
                    ...(end ? { end } : {}),
                    ...(path ? { path } : {}),
                  }).toString(),
                );
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </form>
    </>
  );
}
