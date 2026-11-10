import { useContext } from 'react';
import { rangeLabel } from './date-ranges.ts';
import { ReportWorkspace } from './report-workspace.ts';

export function ReportPeriod({ label }: { label: string }) {
  const workspace = useContext(ReportWorkspace);
  if (!workspace) return null;
  const { start, end, timezone } = workspace.data.range;
  return <span className="analytics-report-period" aria-label={label + '统计范围'} title={start + ' — ' + end}>{rangeLabel(start, end, timezone)}</span>;
}
