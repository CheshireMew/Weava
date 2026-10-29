import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw, X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  AnalyticsReport,
  AnalyticsDimension,
  AnalyticsVisitor,
  AnalyticsRealtime,
  AnalyticsVisitorDetail,
  GeoStatus,
} from '@weava/contracts';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import world from './analytics-world.json';
import './AnalyticsPanel.css';

const number = (v: number) => v.toLocaleString('zh-CN');
const channels: Record<string, string> = {
  'direct-or-unknown': '直接 / 未知',
  'search-referral': '搜索引擎',
  'ai-referral': 'AI 来源',
  social: '社交媒体',
  referral: '其它引荐',
  campaign: '推广链接',
  paid: '付费推广',
  email: '邮件',
};
const devices: Record<string, string> = {
  desktop: '电脑',
  smartphone: '手机',
  tablet: '平板',
  other: '其它设备',
  unknown: '未知',
};
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const country = (code: string) => {
  try {
    return /^[A-Z]{2}$/.test(code) ? regionNames.of(code) || code : '未知';
  } catch {
    return '未知';
  }
};
const duration = (ms: number) =>
  ms < 1000
    ? '—'
    : ms < 60000
      ? Math.round(ms / 1000) + ' 秒'
      : Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
const dateAt = (ts: string, timezone: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts));
function change(now: number, before: number) {
  return before
    ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%`
    : now
      ? '新增'
      : '—';
}
function shift(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
function watchVisible<T>(
  read: () => Promise<T>,
  onValue: (value: T) => void,
  onError: (message: string) => void,
  interval: number,
) {
  let pending = false,
    stopped = false;
  const refresh = async () => {
    if (pending || stopped || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const value = await read();
      if (!stopped) onValue(value);
    } catch (error: any) {
      if (!stopped) onError(error.message);
    } finally {
      pending = false;
    }
  };
  const visibility = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  const timer = setInterval(refresh, interval);
  document.addEventListener('visibilitychange', visibility);
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
function today(timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function Card({
  title,
  children,
  action,
  className = '',
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={'analytics-card ' + className}>
      <div className="analytics-card-title">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
type Column = { label: string; key: string; render?: (row: any) => ReactNode; numeric?: boolean };
function DataTable({
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
function Distribution({
  rows,
  onSelect,
  label = (s) => s,
}: {
  rows: AnalyticsDimension[];
  onSelect: (value: string) => void;
  label?: (name: string) => string;
}) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [rows]);
  return !rows.length ? (
    <p className="analytics-empty">所选范围内暂无数据。</p>
  ) : (
    <div className="analytics-distribution">
      {(all ? rows : rows.slice(0, 6)).map((r) => (
        <button key={r.name} onClick={() => onSelect(r.name)} title={'筛选：' + label(r.name)}>
          <span
            className="analytics-distribution-track"
            style={{ width: Math.max(1, r.share * 100) + '%' }}
          />
          <span>{label(r.name)}</span>
          <strong>{number(r.visitors)}</strong>
          <small>{(r.share * 100).toFixed(1)}%</small>
        </button>
      ))}
      {rows.length > 6 && (
        <button className="analytics-show-all" onClick={() => setAll(!all)}>
          {all ? '收起' : '查看全部 ' + number(rows.length) + ' 项'}
        </button>
      )}
    </div>
  );
}
type Series = { name: string; color: string; values: number[]; total?: number; dashed?: boolean };
function Trend({ dates, series, empty }: { dates: string[]; series: Series[]; empty: boolean }) {
  const [index, setIndex] = useState<number | null>(null),
    [hidden, setHidden] = useState<string[]>([]);
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
          <svg
            viewBox="0 0 820 240"
            role="img"
            aria-label="访问趋势，详细数值见图下数据表"
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
          </svg>
          <details className="analytics-chart-data">
            <summary>查看每日数据</summary>
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
          </details>
        </>
      )}
    </div>
  );
}
function WorldMap({
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
export default function AnalyticsPanel({ onError }: { onError: (s: string) => void }) {
  const [data, setData] = useState<AnalyticsReport | null>(null),
    [live, setLive] = useState<AnalyticsRealtime | null>(null),
    [geo, setGeo] = useState<GeoStatus | null>(null);
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [path, setPath] = useState(''),
    [filters, setFilters] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState(''),
    [loadedQuery, setLoadedQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [geoBusy, setGeoBusy] = useState(false),
    [exportType, setExportType] = useState('pages');
  const [liveError, setLiveError] = useState(''),
    [geoError, setGeoError] = useState('');
  const retryLive = useRef<() => void>(() => {});
  const [visitor, setVisitor] = useState<string | null>(null),
    [detail, setDetail] = useState<AnalyticsVisitorDetail | null>(null),
    [detailError, setDetailError] = useState(''),
    [detailPage, setDetailPage] = useState(1);
  const [excluded, setExcluded] = useState(() => {
    try {
      return localStorage.getItem('weava-exclude') === '1';
    } catch {
      return false;
    }
  });
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = (changes: Record<string, string> = {}) =>
    new URLSearchParams({
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(path ? { path } : {}),
      ...filters,
      ...changes,
    }).toString();
  const load = async (q = applied) => {
    const g = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await api('analytics?' + q);
      if (!mounted.current || g !== generation.current) return;
      setData(result);
      setLoadedQuery(q);
      setLive(result.realtime);
      setLiveError('');
      setGeo(result.geo);
      setGeoError('');
      if (!q) {
        setStart(result.range.start);
        setEnd(result.range.end);
      }
    } catch (e: any) {
      if (mounted.current && g === generation.current) setError(e.message);
    } finally {
      if (mounted.current && g === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(applied);
  }, [applied]);
  useEffect(() => {
    const p = new URLSearchParams(loadedQuery);
    const watch = watchVisible<AnalyticsRealtime>(
      () =>
        api(
          'analytics/realtime?' +
            (p.get('path') ? 'path=' + encodeURIComponent(p.get('path')!) : ''),
        ),
      (next) => {
        setLive(next);
        setLiveError('');
      },
      setLiveError,
      15000,
    );
    retryLive.current = () => {
      void watch.refresh();
    };
    return watch.stop;
  }, [loadedQuery]);
  useEffect(() => {
    if (!geo?.updating) return;
    const watch = watchVisible<GeoStatus>(
      () => api('analytics/geo'),
      (state) => {
        setGeo(state);
        setGeoError('');
      },
      setGeoError,
      2000,
    );
    return watch.stop;
  }, [geo?.updating]);
  const apply = (nextFilters = filters) => {
    const q = query(nextFilters);
    if (q === applied) void load(q);
    else setApplied(q);
  };
  const filter = (key: string, value: string) => {
    const next = { ...filters };
    if (!value) delete next[key];
    else next[key] = value;
    setFilters(next);
    const q = new URLSearchParams({
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(path ? { path } : {}),
      ...next,
    }).toString();
    if (q === applied) void load(q);
    else setApplied(q);
  };
  const preset = (days: number, offset = 0) => {
    const last = shift(today(data?.range.timezone), offset),
      first = shift(last, 1 - days);
    setStart(first);
    setEnd(last);
    setApplied(
      new URLSearchParams({
        start: first,
        end: last,
        ...(path ? { path } : {}),
        ...filters,
      }).toString(),
    );
  };
  const updateGeo = async () => {
    setGeoBusy(true);
    try {
      setGeo(await api('analytics/geo', {}));
      setGeoError('');
    } catch (e: any) {
      setGeoError(e.message);
    } finally {
      setGeoBusy(false);
    }
  };
  useEffect(() => {
    if (!visitor) {
      setDetail(null);
      return;
    }
    let stopped = false;
    setDetail(null);
    setDetailError('');
    void api(
      'analytics/visitor?' +
        new URLSearchParams({
          id: visitor,
          start: data?.range.start || '',
          end: data?.range.end || '',
          page: String(detailPage),
        }),
    )
      .then((v) => {
        if (!stopped) setDetail(v);
      })
      .catch((e) => {
        if (!stopped) setDetailError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [visitor, detailPage]);
  const openVisitor = (id: string) => {
    setDetailPage(1);
    setVisitor(id);
  };
  const zone = data?.range.timezone || 'Asia/Shanghai';
  const pageLabel = (p: string) => {
    if (data?.pageTitles?.[p]) return data.pageTitles[p];
    try {
      return decodeURI(p);
    } catch {
      return p;
    }
  };
  const pageLink = (p: string) => (
    <a href={p} target="_blank" rel="noreferrer" className="analytics-page-link" title={p}>
      {pageLabel(p)}
      <ExternalLink size={12} />
    </a>
  );
  const visitorColumns: Column[] = [
    {
      key: 'id',
      label: '访客',
      render: (v: AnalyticsVisitor) => (
        <button className="analytics-text-button" onClick={() => openVisitor(v.id)} title={v.id}>
          {v.id.slice(0, 8)}
        </button>
      ),
    },
    { key: 'views', label: '浏览', numeric: true },
    {
      key: 'country',
      label: '地区 / 设备',
      render: (v: AnalyticsVisitor) => (
        <span className="analytics-visitor-device">
          {country(v.country)}
          <small>
            {v.browser} · {v.os} · {devices[v.device] || v.device}
          </small>
        </span>
      ),
    },
    { key: 'source', label: '来源' },
    { key: 'entryPath', label: '入口', render: (v) => pageLink(v.entryPath) },
    { key: 'exitPath', label: '最后页面', render: (v) => pageLink(v.exitPath) },
    { key: 'lastSeen', label: '最后访问', render: (v) => dateAt(v.lastSeen, zone) },
  ];
  const pageColumns: Column[] = [
    { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
    { key: 'views', label: '浏览', numeric: true },
    { key: 'visitors', label: '访客', numeric: true },
    { key: 'entries', label: '进入', numeric: true },
    { key: 'exits', label: '退出', numeric: true },
    {
      key: 'averageActiveMs',
      label: '平均停留',
      numeric: true,
      render: (v) => duration(v.averageActiveMs),
    },
  ];
  const dates = data?.daily.map((d) => d.date) || [];
  const exportUrl = '/api/admin/v1/analytics/export?' + loadedQuery + '&dataset=' + exportType;
  const canExport = !!data && !loading && !error;
  return (
    <div className="panel analytics-panel">
      <div className="panel-title">
        <h1>访问统计</h1>
        <div className="analytics-actions">
          <button disabled={loading} onClick={() => load()} aria-label="刷新统计">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <select
            aria-label="导出内容"
            value={exportType}
            onChange={(e) => setExportType(e.target.value)}
          >
            {Object.entries({
              pages: '页面排行',
              daily: '每日趋势',
              sources: '来源',
              countries: '地区',
              browsers: '浏览器',
              os: '操作系统',
              devices: '设备类型',
              models: '设备型号',
              visitors: '最新访客',
              links: '链接点击',
              actions: '关键动作',
              campaigns: '推广链接',
              crawlers: '爬虫请求',
              lifetime: '累计浏览',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <a className="button" href={canExport ? exportUrl : undefined} aria-disabled={!canExport}>
            <Download size={16} />
            CSV
          </a>
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
          <input
            aria-label="页面路径筛选"
            placeholder="全部页面"
            value={path}
            onChange={(e) => setPath(e.target.value)}
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
      {error && (
        <div className="analytics-error" role="alert">
          {error}
          <button onClick={() => load()}>重试</button>
        </div>
      )}
      {loading && !data && <p role="status">正在读取统计…</p>}
      {data && !error && (
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
              <Card title="浏览器">
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
              <div className="analytics-local-options">
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
            <main className="analytics-main">
              <Card title="流量趋势">
                <Trend
                  dates={dates}
                  empty={!data.views && !data.previous.views}
                  series={[
                    {
                      name: '浏览量',
                      color: 'var(--analytics-purple)',
                      values: data.daily.map((d) => d.views),
                      total: data.views,
                    },
                    {
                      name: '访客',
                      color: 'var(--analytics-blue)',
                      values: data.daily.map((d) => d.visitors),
                      total: data.visitors,
                    },
                    {
                      name: '上期浏览',
                      color: 'var(--analytics-purple)',
                      values: data.daily.map((d) => d.previousViews),
                      total: data.previous.views,
                      dashed: true,
                    },
                    {
                      name: '上期访客',
                      color: 'var(--analytics-blue)',
                      values: data.daily.map((d) => d.previousVisitors),
                      total: data.previous.visitors,
                      dashed: true,
                    },
                  ]}
                />
              </Card>
              <Card title="搜索与 AI 来源趋势">
                <Trend
                  dates={dates}
                  empty={!data.engines.length}
                  series={data.engines.flatMap((e, i) => {
                    const color = [
                      'var(--analytics-green)',
                      'var(--analytics-blue)',
                      'var(--analytics-purple)',
                      'var(--analytics-orange)',
                    ][i % 4];
                    return [
                      {
                        name: e.name,
                        color,
                        values: dates.map(
                          (day) => e.daily.find((d) => d.date === day)?.sessions || 0,
                        ),
                      },
                      ...(e.previousSessions
                        ? [
                            {
                              name: e.name + ' 上期',
                              color,
                              dashed: true,
                              values: dates.map(
                                (day) => e.previousDaily.find((d) => d.date === day)?.sessions || 0,
                              ),
                            },
                          ]
                        : []),
                    ];
                  })}
                />
                <p className="analytics-note">
                  按会话首次来源统计；来源被隐藏的访问归入直接 / 未知。
                </p>
              </Card>
              <Card title="页面排行">
                <DataTable rows={data.pages} columns={pageColumns} />
              </Card>
              <Card title="访问来源">
                <DataTable
                  rows={data.sources}
                  columns={[
                    {
                      key: 'name',
                      label: '来源',
                      render: (v) => (
                        <span className="analytics-visitor-device">
                          {v.name}
                          {v.host && v.host !== v.name && <small>{v.host}</small>}
                        </span>
                      ),
                    },
                    {
                      key: 'channel',
                      label: '渠道',
                      render: (v) => channels[v.channel] || v.channel,
                    },
                    { key: 'sessions', label: '会话', numeric: true },
                    { key: 'visitors', label: '访客', numeric: true },
                    { key: 'views', label: '浏览', numeric: true },
                  ]}
                />
              </Card>
              <Card title="最活跃访客">
                <DataTable rows={data.activeVisitors} columns={visitorColumns} size={10} />
              </Card>
              <Card title="最新访客">
                <DataTable rows={data.recentVisitors} columns={visitorColumns} size={10} />
                {data.recentVisitors.length === 100 && (
                  <p className="analytics-note">展示所选范围内最近 100 位访客。</p>
                )}
              </Card>
              <Card
                title="当前在线"
                action={
                  <span className="analytics-live-count">
                    <i />
                    {live?.count || 0}
                  </span>
                }
              >
                {liveError && (
                  <p role="status" className="analytics-note">
                    实时数据更新失败，保留 {live ? dateAt(live.at, zone) : '此前'} 的记录。
                    <button className="analytics-text-button" onClick={() => retryLive.current()}>
                      重试实时统计
                    </button>
                  </p>
                )}
                <DataTable
                  rows={live?.visitors || []}
                  empty="当前没有在线访客。"
                  columns={[
                    {
                      key: 'id',
                      label: '访客',
                      render: (v) => (
                        <button className="analytics-text-button" onClick={() => openVisitor(v.id)}>
                          {v.id.slice(0, 8)}
                        </button>
                      ),
                    },
                    { key: 'country', label: '地区', render: (v) => country(v.country) },
                    { key: 'browser', label: '浏览器' },
                    { key: 'path', label: '当前页面', render: (v) => pageLink(v.path) },
                    { key: 'lastSeen', label: '最后活动', render: (v) => dateAt(v.lastSeen, zone) },
                  ]}
                />
                <p className="analytics-note">
                  最近 5 分钟收到可见页面心跳的访客，每 15 秒刷新。此处按当前时间统计
                  {new URLSearchParams(loadedQuery).get('path') ? '，页面路径筛选生效' : '全站'}。
                </p>
              </Card>
              <Card title="全球访客分布">
                <WorldMap rows={data.countries} onSelect={(v) => filter('country', v)} />
                <div className="analytics-geo-status">
                  <span>
                    <a href="https://db-ip.com" target="_blank" rel="noreferrer">
                      IP Geolocation by DB-IP
                    </a>{' '}
                    ·{' '}
                    {geo?.available
                      ? `地区库 ${geo.builtAt?.slice(0, 10) || ''}`
                      : '地区库尚未就绪'}
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
              <Card title="链接点击">
                <DataTable
                  rows={data.links}
                  columns={[
                    { key: 'label', label: '链接文字' },
                    { key: 'path', label: '所在页面', render: (v) => pageLink(v.path) },
                    {
                      key: 'url',
                      label: '目标',
                      render: (v) => (
                        <span className="analytics-url" title={v.url}>
                          {v.url}
                        </span>
                      ),
                    },
                    {
                      key: 'zone',
                      label: '位置',
                      render: (v) =>
                        (
                          ({ header: '页头', body: '正文', footer: '页尾' }) as Record<
                            string,
                            string
                          >
                        )[v.zone] || v.zone,
                    },
                    { key: 'clicks', label: '点击', numeric: true },
                  ]}
                />
              </Card>
              <Card title="关键动作">
                <DataTable
                  rows={data.actions}
                  columns={[
                    { key: 'name', label: '动作' },
                    { key: 'count', label: '次数', numeric: true },
                  ]}
                />
              </Card>
              {data.campaigns.length > 0 && (
                <Card title="推广链接">
                  <DataTable
                    rows={data.campaigns}
                    columns={[
                      { key: 'source', label: '来源' },
                      { key: 'medium', label: '媒介' },
                      { key: 'campaign', label: '活动' },
                      { key: 'sessions', label: '会话', numeric: true },
                      { key: 'views', label: '浏览', numeric: true },
                    ]}
                  />
                </Card>
              )}
              <Card title="爬虫请求">
                <DataTable
                  rows={data.crawlers}
                  columns={[
                    { key: 'agent', label: '声明身份' },
                    { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
                    { key: 'status', label: '状态' },
                    { key: 'requests', label: '请求', numeric: true },
                  ]}
                />
                <p className="analytics-note">
                  按 User-Agent 声明分类，单独记录，不计入访客浏览；不代表 AI 回答引用。
                </p>
              </Card>
              {data.historicalViews > 0 && (
                <Card title="累计浏览">
                  <p className="analytics-note">
                    共 {number(data.lifetimeViews)} 次，其中迁移历史浏览{' '}
                    {number(data.historicalViews)}{' '}
                    次。历史总数没有访问明细，不计入日期趋势、地区和设备分布。
                  </p>
                  <DataTable
                    rows={data.lifetimePages}
                    columns={[
                      { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
                      { key: 'views', label: '累计浏览', numeric: true },
                      { key: 'historicalViews', label: '迁移历史', numeric: true },
                      { key: 'recordedViews', label: '新记录', numeric: true },
                    ]}
                  />
                </Card>
              )}
              {data.legacySources.length > 0 && (
                <p className="analytics-note">
                  另保留 {data.legacySources.length} 份迁移前统计档案，存放在站点 imports 目录。
                </p>
              )}
            </main>
          </div>
        </div>
      )}
      {visitor && (
        <Dialog
          className="modal analytics-visitor-dialog"
          onClose={() => setVisitor(null)}
          label="访客访问记录"
        >
          <div className="analytics-card-title">
            <h2>访客 {visitor.slice(0, 8)}</h2>
            <button onClick={() => setVisitor(null)} aria-label="关闭访客记录">
              <X size={18} />
            </button>
          </div>
          <p className="analytics-note">
            {data?.range.start} — {data?.range.end} · {zone}
          </p>
          {detailError ? (
            <p role="alert">{detailError}</p>
          ) : !detail ? (
            <p role="status">正在读取访问记录…</p>
          ) : (
            <>
              <DataTable
                rows={detail.events}
                size={50}
                columns={[
                  { key: 'ts', label: '时间', render: (v) => dateAt(v.ts, zone) },
                  { key: 'session', label: '会话', render: (v) => v.session.slice(0, 8) },
                  {
                    key: 'kind',
                    label: '活动',
                    render: (v) =>
                      (
                        ({ view: '浏览', click: '点击', event: '关键动作' }) as Record<
                          string,
                          string
                        >
                      )[v.kind] || v.kind,
                  },
                  { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
                  { key: 'label', label: '内容' },
                  {
                    key: 'activeMs',
                    label: '停留',
                    render: (v) => (v.kind === 'view' ? duration(v.activeMs) : '—'),
                  },
                  {
                    key: 'scroll',
                    label: '阅读进度',
                    render: (v) => (v.kind === 'view' ? v.scroll + '%' : '—'),
                  },
                ]}
              />
              {detail.pages > 1 && (
                <div className="analytics-pagination">
                  <span>
                    共 {number(detail.total)} 条 · {detail.page}/{detail.pages}
                  </span>
                  <button
                    disabled={detail.page <= 1}
                    onClick={() => setDetailPage(detail.page - 1)}
                  >
                    上一页
                  </button>
                  <button
                    disabled={detail.page >= detail.pages}
                    onClick={() => setDetailPage(detail.page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
