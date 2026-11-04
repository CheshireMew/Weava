import React, { useEffect, useState } from 'react';

import { number } from './format.ts';
import { DataTable } from './DataTable.tsx';

type Series = { name: string; color: string; values: number[]; total?: number; dashed?: boolean };
export function Trend({
  dates,
  series,
  empty,
}: {
  dates: string[];
  series: Series[];
  empty: boolean;
}) {
  const [index, setIndex] = useState<number | null>(null),
    [hidden, setHidden] = useState<string[]>([]);
  const [view, setView] = useState('chart');
  useEffect(() => {
    setIndex(null);
    setHidden([]);
  }, [dates]);
  const visible = series.filter((s) => !hidden.includes(s.name)),
    max = Math.max(1, ...visible.flatMap((s) => s.values));
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4),
    x = (i: number) => 48 + (dates.length === 1 ? 366 : (i / (dates.length - 1)) * 732),
    y = (v: number) => 200 - (v / ceiling) * 172;
  const select = (event: React.PointerEvent<SVGSVGElement>) => {
    const b = event.currentTarget.getBoundingClientRect();
    setIndex(
      Math.max(
        0,
        Math.min(
          dates.length - 1,
          Math.round(
            ((((event.clientX - b.left) / b.width) * 820 - 48) / 732) * (dates.length - 1),
          ),
        ),
      ),
    );
  };
  return (
    <div className="analytics-trend">
      <div className="analytics-view-switch" role="group" aria-label="趋势显示方式">{[['chart', '图表'], ['data', '数据']].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setIndex(null); }}>{label}</button>)}</div>
      <div className="analytics-legend">
        {series.map((s) => (
          <button
            key={s.name}
            aria-pressed={!hidden.includes(s.name)}
            onClick={() =>
              setHidden(
                hidden.includes(s.name) ? hidden.filter((n) => n !== s.name) : [...hidden, s.name],
              )
            }
          >
            <i style={{ background: s.color, opacity: hidden.includes(s.name) ? 0.25 : 1 }} />
            {s.name}
            <strong>
              {number(
                index === null
                  ? (s.total ?? s.values.reduce((a, b) => a + b, 0))
                  : s.values[index] || 0,
              )}
            </strong>
          </button>
        ))}
      </div>
      {empty ? (
        <p className="analytics-empty">所选范围内暂无访问记录。</p>
      ) : (
        <>
          {view === 'chart' && <svg
            viewBox="0 0 820 240"
            role="img"
            aria-label="访问趋势，可切换到数据查看详细数值"
            onPointerMove={select}
            onPointerLeave={() => setIndex(null)}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <g key={n}>
                <line
                  x1="48"
                  x2="780"
                  y1={y((ceiling * n) / 4)}
                  y2={y((ceiling * n) / 4)}
                  className="analytics-grid-line"
                />
                <text x="38" y={y((ceiling * n) / 4) + 4} textAnchor="end">
                  {number((ceiling * n) / 4)}
                </text>
              </g>
            ))}
            {visible.map((s) =>
              dates.length === 1 ? (
                <circle
                  key={s.name}
                  data-series={s.name}
                  cx={x(0)}
                  cy={y(s.values[0] || 0)}
                  r={s.dashed ? 5 : 4}
                  fill={s.dashed ? 'var(--surface)' : s.color}
                  stroke={s.color}
                  strokeWidth="2"
                />
              ) : (
                <polyline
                  key={s.name}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.5 : 2.5}
                  strokeDasharray={s.dashed ? '5 5' : undefined}
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                />
              ),
            )}
            {[
              ...new Set([
                0,
                Math.floor((dates.length - 1) / 4),
                Math.floor((dates.length - 1) / 2),
                Math.floor(((dates.length - 1) * 3) / 4),
                dates.length - 1,
              ]),
            ].map((i) => (
              <text key={i} x={x(i)} y="226" textAnchor="middle">
                {dates[i]?.slice(5)}
              </text>
            ))}
            {index !== null && (
              <g>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1="20"
                  y2="202"
                  stroke="var(--ink-muted)"
                  strokeDasharray="3 3"
                />
                {visible.map((s) => (
                  <circle
                    key={s.name}
                    cx={x(index)}
                    cy={y(s.values[index] || 0)}
                    r="4"
                    fill={s.color}
                  />
                ))}
                <text x={Math.min(700, Math.max(60, x(index)))} y="14" textAnchor="middle">
                  {dates[index]}
                </text>
              </g>
            )}
          </svg>}
          {view === 'data' && <div className="analytics-chart-data">
            <DataTable
              size={7}
              rows={dates.map((date, i) =>
                Object.fromEntries([
                  ['date', date],
                  ...series.map((s) => [s.name, s.values[i] || 0]),
                ]),
              )}
              columns={[
                { key: 'date', label: '日期' },
                ...series.map((s) => ({ key: s.name, label: s.name, numeric: true })),
              ]}
            />
          </div>}
        </>
      )}
    </div>
  );
}
