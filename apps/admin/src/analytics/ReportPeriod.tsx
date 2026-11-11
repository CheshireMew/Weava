import { useContext } from 'react';
import { rangeLabel } from './date-ranges.ts';
import { ReportWorkspace } from './report-workspace.ts';
import { DateRangeMenu } from './DateRangeMenu.tsx';

export function ReportPeriod({ label, selectable = false }: { label: string; selectable?: boolean }) {
  const workspace = useContext(ReportWorkspace);
  if (!workspace) return null;
  const { start, end, timezone } = selectable ? workspace.range ?? workspace.data.range : workspace.data.range;
  if(selectable)return <DateRangeMenu label="统计" start={start} end={end} timezone={timezone} disabled={workspace.loading} onChange={workspace.changeRange}/>;
  return <span className="analytics-report-period" aria-label={label + '统计范围'} title={start + ' — ' + end}>{rangeLabel(start, end, timezone)}</span>;
}
