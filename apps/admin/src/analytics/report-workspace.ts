import { createContext, type MouseEvent } from 'react';
import type { AnalyticsReport } from '@weava/contracts';
import type { ReportName } from './report-navigation.ts';

export const ReportWorkspace = createContext<{
  data: AnalyticsReport; query: string;
  navigate: (report: ReportName | null, query?: string) => void;
  openVisitor: (id: string, data: AnalyticsReport) => void;
} | null>(null);
export const reportQuery = (data: AnalyticsReport) => new URLSearchParams({ start: data.range.start, end: data.range.end }).toString();
export function internalClick(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); action(); }
}
