import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from '../Popover.tsx';
import { dateRange, rangeChoices, rangeLabel } from './date-ranges.ts';

export function DateRangeMenu({ start, end, timezone, label, onChange, disabled = false }: {
  start: string; end: string; timezone: string; label: string;
  onChange: (start: string, end: string) => void; disabled?: boolean;
}) {
  const [custom, setCustom] = useState(false), [first, setFirst] = useState(start), [last, setLast] = useState(end);
  const selected = rangeLabel(start, end, timezone);
  return <div className="analytics-date-menu" aria-busy={disabled}>
    <Popover label={label + '日期范围'} trigger={<>{selected}<ChevronDown size={13} /></>} className="analytics-date-popover" align="start">
      {close => <>
        <div className="analytics-date-current"><strong>{selected}</strong><span>{start} — {end}</span><small>{timezone}</small></div>
        <div className="analytics-date-choices">{rangeChoices.map(([key, text]) => <button type="button" key={key} disabled={disabled} aria-pressed={selected === text} onClick={() => {
          const range = dateRange(key, timezone); onChange(range.start, range.end); setCustom(false); close();
        }}>{text}{selected === text && <Check size={14} />}</button>)}</div>
        <button type="button" className="analytics-custom-toggle" aria-expanded={custom} onClick={() => { setFirst(start); setLast(end); setCustom(!custom); }}>自定义日期…</button>
        {custom && <form className="analytics-custom-range" onSubmit={event => {
          event.preventDefault();
          const values = new FormData(event.currentTarget), start = String(values.get('start') || ''), end = String(values.get('end') || '');
          if (!start || !end || start > end) return;
          onChange(start, end); setCustom(false); close();
        }}>
          <label>开始日期<input name="start" type="date" required value={first} max={last || undefined} onChange={event => setFirst(event.target.value)} /></label>
          <label>结束日期<input name="end" type="date" required value={last} min={first || undefined} onChange={event => setLast(event.target.value)} /></label>
          <button type="submit" disabled={disabled || !first || !last || first > last}>应用日期</button>
        </form>}
      </>}
    </Popover>
  </div>;
}
