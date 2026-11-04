import { useState } from 'react';

import { Card } from './Card.tsx';

import { Distribution } from './Distribution.tsx';

import { number, devices, country, change } from './format.ts';

import type { AnalyticsView } from './types.ts';
export function AnalyticsSidebar({
  model,
}: {
  model: Pick<AnalyticsView, 'data' | 'filters' | 'filter' | 'onError'>;
}) {
  const { data, filters, filter, onError } = model;
  const [excluded, setExcluded] = useState(() => {
    try {
      return localStorage.getItem('weava-exclude') === '1';
    } catch {
      return false;
    }
  });
  return (
    <>
      {' '}
      <aside className="analytics-sidebar">
        <Card title="流量概览">
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
        </Card>
        <Card title="国家 / 地区">
          <Distribution
            rows={data.countries}
            label={country}
            onSelect={(v) => filter('country', v)}
          />
        </Card>
        <details className="settings-disclosure"><summary>设备详情</summary><Card title="浏览器">
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
        </details><div className="analytics-local-options">
          <label>
            <input
              type="checkbox"
              checked={excluded}
              onChange={(e) => {
                const next = e.target.checked;
                try {
                  localStorage.setItem('weava-exclude', next ? '1' : '0');
                  setExcluded(next);
                } catch {
                  onError('浏览器不允许保存排除设置。');
                }
              }}
            />
            排除本机后续访问
          </label>
          <p>清除浏览器数据或换设备后会识别为新访客。</p>
        </div>
      </aside>
    </>
  );
}
