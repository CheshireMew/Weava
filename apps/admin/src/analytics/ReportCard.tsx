import { useContext, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AnalyticsReport } from '@weava/contracts';
import { reports, reportUrl, type ReportName } from './report-navigation.ts';
import { ReportWorkspace, internalClick } from './report-workspace.ts';
import { ReportPeriod } from './ReportPeriod.tsx';

export function ReportCard({ report, title = reports[report].title, children, selectDate = false }: {
  report: ReportName; title?: string; children: (data: AnalyticsReport, query: string) => ReactNode; selectDate?: boolean;
}) {
  const workspace = useContext(ReportWorkspace)!;
  return <section className="analytics-card" aria-label={title}>
    <header className="analytics-card-title"><h2>{title}</h2></header>
    <div className="analytics-card-content">{children(workspace.data, workspace.query)}</div>
    <footer className="analytics-card-footer"><ReportPeriod label={title} selectable={selectDate} /><a href={reportUrl(report, workspace.query)} onClick={event => internalClick(event, () => workspace.navigate(report, workspace.query))}>查看{reports[report].title}<ArrowRight size={13} /></a></footer>
  </section>;
}
