import { Card } from './Card.tsx';

import { WorldMap } from './WorldMap.tsx';

import type { AnalyticsView } from './types.ts';
export function AnalyticsGeography({
  model,
}: {
  model: Pick<
    AnalyticsView,
    'data' | 'geo' | 'error' | 'geoBusy' | 'geoError' | 'filter' | 'updateGeo'
  >;
}) {
  const { data, geo, geoBusy, geoError, filter, updateGeo } = model;

  return (
    <>
      {' '}
      <Card title="全球访客分布" dateRange>
        <WorldMap rows={data.countries} onSelect={(v) => filter('country', v)} />
        <div className="analytics-geo-status">
          <span>
            <a href="https://db-ip.com" target="_blank" rel="noreferrer">
              IP Geolocation by DB-IP
            </a>{' '}
            · {geo?.available ? `地区库 ${geo.builtAt?.slice(0, 10) || ''}` : '地区库尚未就绪'}
          </span>
          <button disabled={geoBusy || geo?.updating} onClick={updateGeo}>
            {geo?.updating ? '正在下载…' : geo?.available ? '更新地区库' : '下载免费地区库'}
          </button>
        </div>
        {geo?.error && (
          <p role="status" className="analytics-note">
            {geo.error}。可重试更新；已有地区库继续使用。
          </p>
        )}
        {geoError && (
          <p role="status" className="analytics-note">
            {geoError}。地区库状态暂未更新。
          </p>
        )}
      </Card>
    </>
  );
}
