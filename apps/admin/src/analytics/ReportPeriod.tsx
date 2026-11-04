import { useContext } from 'react';
import { DateRangeMenu } from './DateRangeMenu.tsx';
import { ReportWorkspace } from './report-workspace.ts';

export function ReportPeriod({ label }: { label: string }) {
  const workspace = useContext(ReportWorkspace);
  if (!workspace) return null;
  return <DateRangeMenu label={label} {...workspace.data.range} disabled={workspace.loading} onChange={workspace.changeRange} />;
}
