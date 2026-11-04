import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { number } from './format.ts';
import { DataTable } from './DataTable.tsx';

type Series = { name: string; group?: string; color: string; values: number[]; total?: number; dashed?: boolean };
export function Trend({ dates, series, empty, detail = false }: { dates: string[]; series: Series[]; empty: boolean; detail?: boolean }) {
  const [index, setIndex] = useState<number | null>(null), [hidden, setHidden] = useState<string[]>([]), [view, setView] = useState('chart');
  const plot = useRef<HTMLDivElement>(null), [width, setWidth] = useState(820);
  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const resize = () => { const value = element.getBoundingClientRect().width; if (value) setWidth(Math.max(320, Math.round(value))); };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [empty, view]);
  useEffect(() => { setIndex(null); setHidden([]); }, [dates]);
  const visible = series.filter(s => !hidden.includes(s.name)), max = Math.max(1, ...visible.flatMap(s => s.values));
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4);
  const x = (i: number) => 40 + (dates.length === 1 ? (width - 60) / 2 : i / (dates.length - 1) * (width - 60));
  const y = (value: number) => 180 - value / ceiling * 152;
  const toggle = (name: string) => setHidden(old => old.includes(name) ? old.filter(value => value !== name) : [...old, name]);
  const select = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setIndex(Math.max(0, Math.min(dates.length - 1, Math.round((((event.clientX - bounds.left) / bounds.width) * width - 40) / (width - 60) * (dates.length - 1)))));
  };
  const total = (s: Series) => number(s.total ?? s.values.reduce((a, b) => a + b, 0));
  return <div className="analytics-trend">
    <div className="analytics-chart-heading">
      <div className="analytics-legend">{series.filter(s => !s.dashed).map(s => {
        const previous = series.find(item => item.dashed && item.group === s.name);
        return <div className="analytics-legend-group" key={s.name}>
          <span>{s.name}</span><div><button aria-pressed={!hidden.includes(s.name)} title={'显示或隐藏' + s.name} onClick={() => toggle(s.name)}><i style={{ borderColor: s.color }} /><strong>{total(s)}</strong></button>
          {previous && <button aria-pressed={!hidden.includes(previous.name)} title={'上期' + s.name + '：' + total(previous)} onClick={() => toggle(previous.name)}><i className="dashed" style={{ borderColor: s.color }} /><span>{total(previous)}</span></button>}</div>
        </div>;
      })}</div>
      <div className="analytics-chart-options"><span className="analytics-previous-key"><i />上期</span>{detail && <div className="analytics-view-switch" role="group" aria-label="趋势显示方式">{[['chart', '图表'], ['data', '数据']].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setIndex(null); }}>{label}</button>)}</div>}</div>
    </div>
    {empty ? <p className="analytics-empty analytics-empty-chart">所选日期范围内暂无记录。</p> : view === 'data' && detail ? <DataTable rows={dates.map((date, i) => Object.fromEntries([['date', date], ...series.map(s => [s.name, s.values[i] || 0])]))} columns={[{ key: 'date', label: '日期' }, ...series.map(s => ({ key: s.name, label: s.name, numeric: true }))]} size={31} /> :
      <div ref={plot} className="analytics-chart-plot">
        <svg viewBox={'0 0 ' + width + ' 220'} role="img" aria-label="访问趋势，可用左右方向键逐日查看数值" tabIndex={0} onPointerMove={select} onPointerLeave={() => setIndex(null)} onBlur={() => setIndex(null)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) { event.preventDefault(); setIndex(old => event.key === 'Escape' ? null : event.key === 'Home' ? 0 : event.key === 'End' ? dates.length - 1 : Math.max(0, Math.min(dates.length - 1, (old ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1)))); }
        }}>
          {[0, 1, 2, 3, 4].map(n => <g key={n}><line x1="40" x2={width - 20} y1={y(ceiling * n / 4)} y2={y(ceiling * n / 4)} className="analytics-grid-line" /><text x="30" y={y(ceiling * n / 4) + 4} textAnchor="end">{number(ceiling * n / 4)}</text></g>)}
          {visible.map(s => dates.length === 1 ? <circle key={s.name} cx={x(0)} cy={y(s.values[0] || 0)} r={s.dashed ? 5 : 4} fill={s.dashed ? 'var(--surface)' : s.color} stroke={s.color} strokeWidth="2" /> :
            <polyline key={s.name} data-series={s.name} fill="none" stroke={s.color} opacity={s.dashed ? .55 : 1} strokeWidth={s.dashed ? 1.6 : 2.6} strokeDasharray={s.dashed ? '5 5' : undefined} points={s.values.map((value, i) => x(i) + ',' + y(value)).join(' ')} />)}
          {[...new Set(width < 500 ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1] : [0, Math.floor((dates.length - 1) / 4), Math.floor((dates.length - 1) / 2), Math.floor((dates.length - 1) * 3 / 4), dates.length - 1])].map(i => <text key={i} x={x(i)} y="206" textAnchor="middle">{dates[i]?.slice(5)}</text>)}
          {index !== null && <g><line x1={x(index)} x2={x(index)} y1="20" y2="182" stroke="var(--ink-muted)" strokeDasharray="3 3" />{visible.map(s => <circle key={s.name} cx={x(index)} cy={y(s.values[index] || 0)} r="4" fill={s.color} />)}</g>}
        </svg>
        {index !== null && <div className={'analytics-chart-tooltip' + (index > dates.length / 2 ? ' tooltip-left' : '')} role="status"><strong>{dates[index]}</strong>{visible.map(s => <div key={s.name}><i className={s.dashed ? 'dashed' : ''} style={{ borderColor: s.color }} /><span>{s.name}</span><b>{number(s.values[index] || 0)}</b></div>)}</div>}
      </div>}
  </div>;
}
