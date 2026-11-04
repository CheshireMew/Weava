import { Card } from './Card.tsx';

import { Distribution } from './Distribution.tsx';

import { number, devices, country, change } from './format.ts';

import type { AnalyticsView } from './types.ts';
export function AnalyticsSidebar({
  model, section = 'overview',
}: {
  section?: 'overview' | 'countries' | 'devices';
  model: Pick<AnalyticsView, 'data' | 'filters' | 'filter' | 'onError'>;
}) {
  const { data, filters, filter } = model;
  return (
    <>
      {' '}
      <aside className={section === 'devices' ? 'analytics-section-grid' : 'analytics-sidebar'}>
        {section === 'overview' && <Card title="流量概览">
          <table className="analytics-overview">
            <thead>
              <tr>
                <th>时间</th>
                <th>访客</th>
                <th>浏览</th>
              </tr>
            </thead>
            <tbody>
              {data.overview.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>
                    {number(r.visitors)}
                    <small>{change(r.visitors, r.previous.visitors)}</small>
                  </td>
                  <td>
                    {number(r.views)}
                    <small>{change(r.views, r.previous.views)}</small>
                  </td>
                </tr>
              ))}
              <tr>
                <td>累计记录</td>
                <td>{number(data.lifetime.visitors)}</td>
                <td>{number(data.lifetime.views)}</td>
              </tr>
            </tbody>
          </table>
          {Object.keys(filters).length > 0 && (
            <p className="analytics-note">概览展示全站时间统计，页面路径筛选仍生效。</p>
          )}
        </Card>}
        {section === 'countries' && <Card title="国家 / 地区">
          <Distribution
            rows={data.countries}
            label={country}
            onSelect={(v) => filter('country', v)}
          />
        </Card>}
        {section === 'devices' && <><Card title="浏览器">
          <Distribution rows={data.browsers} onSelect={(v) => filter('browser', v)} />
        </Card>
        <Card title="操作系统">
          <Distribution rows={data.operatingSystems} onSelect={(v) => filter('os', v)} />
        </Card>
        <Card title="设备类型">
          <Distribution
            rows={data.devices}
            label={(v) => devices[v] || v}
            onSelect={(v) => filter('device', v)}
          />
        </Card>
        <Card title="设备型号">
          <Distribution rows={data.models} onSelect={(v) => filter('model', v)} />
        </Card>
        </>}
      </aside>
    </>
  );
}
