import { useState } from 'react';

import type { AnalyticsDimension } from '@weava/contracts';

import world from '../analytics-world.json';

import { number, country } from './format.ts';

export function WorldMap({
  rows,
  onSelect,
}: {
  rows: AnalyticsDimension[];
  onSelect: (name: string) => void;
}) {
  const known = rows.filter((r) => /^[A-Z]{2}$/.test(r.name)),
    counts = new Map(known.map((r) => [r.name, r.visitors])),
    max = Math.max(1, ...known.map((r) => r.visitors));
  const [selected, setSelected] = useState('');
  const activate = (id: string) => {
    setSelected(id);
    onSelect(id);
  };
  const fill = (id: string) =>
    counts.has(id)
      ? `hsl(154 30% ${86 - Math.sqrt((counts.get(id) || 0) / max) * 48}%)`
      : 'var(--surface-secondary)';
  return (
    <>
      <div className="analytics-map">
        <svg viewBox="0 0 720 340" role="group" aria-label="按国家或地区展示访客分布">
          {world.map((region) => (
            <path
              key={region.id + region.name}
              d={region.d}
              fill={fill(region.id)}
              stroke="var(--surface)"
              strokeWidth="0.55"
              fillRule="evenodd"
              role={counts.has(region.id) ? 'button' : undefined}
              tabIndex={counts.has(region.id) ? 0 : undefined}
              aria-label={`${country(region.id)}：${counts.get(region.id) || 0} 位访客`}
              onClick={() => counts.has(region.id) && activate(region.id)}
              onKeyDown={(e) => {
                if (counts.has(region.id) && ['Enter', ' '].includes(e.key)) {
                  e.preventDefault();
                  activate(region.id);
                }
              }}
            >
              <title>
                {country(region.id)}：{number(counts.get(region.id) || 0)} 位访客
              </title>
            </path>
          ))}
          {[
            { id: 'SG', x: 567.6, y: 167.4 },
            { id: 'HK', x: 588.3, y: 125.4 },
          ]
            .filter((r) => counts.has(r.id))
            .map((r) => (
              <circle
                key={r.id}
                cx={r.x}
                cy={r.y}
                r="3.5"
                fill={fill(r.id)}
                stroke="var(--ink-muted)"
                role="button"
                tabIndex={0}
                aria-label={country(r.id)}
                onClick={() => activate(r.id)}
                onKeyDown={(e) => {
                  if (['Enter', ' '].includes(e.key)) {
                    e.preventDefault();
                    activate(r.id);
                  }
                }}
              >
                <title>
                  {country(r.id)}：{counts.get(r.id)} 位访客
                </title>
              </circle>
            ))}
        </svg>
      </div>
      <div className="analytics-map-key">
        <span>0</span>
        <i />
        <span>{number(max)}</span>
        {selected && <span>{country(selected)}</span>}
      </div>
      {!known.length && (
        <p className="analytics-empty">
          暂无可定位的访问。内网地址及未采集地区的历史记录归为未知。
        </p>
      )}
    </>
  );
}
