import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { number } from './format.ts';

export type Column = {
  label: string;
  key: string;
  render?: (row: any) => ReactNode;
  numeric?: boolean;
};
export function DataTable({
  rows,
  columns,
  empty = '所选范围内暂无数据。',
  size = 10,
}: {
  rows: any[];
  columns: Column[];
  empty?: string;
  size?: number;
}) {
  const [page, setPage] = useState(1),
    [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  useEffect(() => setPage(1), [rows]);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const av = a[sort.key],
          bv = b[sort.key];
        return (
          (typeof av === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))) *
          (sort.desc ? -1 : 1)
        );
      })
    : rows;
  const pages = Math.ceil(sorted.length / size),
    current = Math.min(page, pages || 1);
  return !rows.length ? (
    <p className="analytics-empty">{empty}</p>
  ) : (
    <>
      <div className="analytics-table-scroll">
        <table className="analytics-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={col.numeric ? 'numeric' : ''}
                  aria-sort={
                    sort?.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'
                  }
                >
                  <button
                    onClick={() =>
                      setSort({
                        key: col.key,
                        desc: sort?.key === col.key ? !sort.desc : !!col.numeric,
                      })
                    }
                  >
                    {col.label}
                    {sort?.key === col.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice((current - 1) * size, current * size).map((row, i) => (
              <tr key={row.id || i}>
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? 'numeric' : ''}>
                    {col.render
                      ? col.render(row)
                      : typeof row[col.key] === 'number'
                        ? number(row[col.key])
                        : row[col.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="analytics-pagination">
          <span>
            共 {number(rows.length)} 项 · {current} / {pages}
          </span>
          <button aria-label="上一页" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="下一页"
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
