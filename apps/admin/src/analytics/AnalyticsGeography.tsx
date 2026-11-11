import { Card } from './Card.tsx';

import { WorldMap } from './WorldMap.tsx';

import type { AnalyticsView } from './types.ts';
export function AnalyticsGeography({
  model,
}: {
  model: Pick<
    AnalyticsView,
    'data' | 'geo' | 'error' | 'geoBusy' | 'geoError' | 'updateGeo'
  >;
}) {
  const { data, geo, geoBusy, geoError, updateGeo } = model;

  return (
    <>
      {' '}
      <Card title="全球访客分布" dateRange>
        <WorldMap rows={data.countries} />
        <div className="analytics-geo-status">
          <span>
            <a href="https://db-ip.com" target="_blank" rel="noreferrer">
              IP Geolocation by DB-IP
            </a>
          </span>
          {!geo?.available&&!geo?.error&&<span role="status">正在准备地区统计…</span>}
        </div>
        {(geo?.error||geoError) && (
          <p role="status" className="analytics-note">
            {geo?.available?'地区统计暂时未能更新，已有统计仍可查看。':'地区统计暂时无法使用，其它统计不受影响。'}<button disabled={geoBusy||geo?.updating} onClick={updateGeo}>{geoBusy||geo?.updating?'正在重试…':'重试'}</button>
          </p>
        )}
      </Card>
    </>
  );
}
