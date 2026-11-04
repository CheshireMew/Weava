import { useEffect, useState, type ReactNode } from 'react';

import type { AnalyticsDimension } from '@weava/contracts';

import { number } from './format.ts';

export function Distribution({
  rows,
  onSelect,
  label = (s) => s,
  icon,
  allRows = false,
  controls = true,
}: {
  rows: AnalyticsDimension[];
  onSelect: (value: string) => void;
  label?: (name: string) => string;
  icon?: (name: string) => ReactNode;
  allRows?: boolean;
  controls?: boolean;
}) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [rows]);
  return !rows.length ? (
    <p className="analytics-empty">所选范围内暂无数据。</p>
  ) : (
    <div className="analytics-distribution">
      {(all || allRows ? rows : rows.slice(0, 6)).map((r) => (
        <button key={r.name} onClick={() => onSelect(r.name)} title={'筛选：' + label(r.name)}>
          <span
            className="analytics-distribution-track"
            style={{ width: Math.max(1, r.share * 100) + '%' }}
          />
          <span className="analytics-dimension-label">{icon?.(r.name)}{label(r.name)}</span>
          <strong>{number(r.visitors)}</strong>
          <small>{(r.share * 100).toFixed(1)}%</small>
        </button>
      ))}
      {controls && !allRows && rows.length > 6 && (
        <button className="analytics-show-all" onClick={() => setAll(!all)}>
          {all ? '收起' : '查看全部 ' + number(rows.length) + ' 项'}
        </button>
      )}
    </div>
  );
}
