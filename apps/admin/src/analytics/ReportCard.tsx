import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AnalyticsReport } from '@weava/contracts';
import { DateRangeMenu } from './DateRangeMenu.tsx';
import { reports, reportUrl, type ReportName } from './report-navigation.ts';
import { ReportWorkspace, reportQuery, internalClick } from './report-workspace.ts';
export function ReportCard({ id, report, title = reports[report].title, children, className = '' }: {
  id: string; report: ReportName; title?: string; className?: string;
  children: (data: AnalyticsReport, query: string) => ReactNode;
}) {
  const workspace = useContext(ReportWorkspace)!;
  const query = workspace.ranges[id] || '';
  const [result, setResult] = useState<AnalyticsReport | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    if (!query) { setResult(null); setBusy(false); setError(''); return; }
    setBusy(true); setError('');
    workspace.fetch(query).then(data => { if (version === generation.current) setResult(data); })
      .catch(e => { if (version === generation.current) setError(e.message); })
      .finally(() => { if (version === generation.current) setBusy(false); });
    return () => { ++generation.current; };
  }, [query, workspace.refresh, retry]);
  const data = result || workspace.data, loadedQuery = reportQuery(data);
  return <section className={'analytics-card analytics-report-card ' + className} aria-label={title} aria-busy={busy}>
    <header className="analytics-card-title"><h2>{title}</h2>{busy && <span className="analytics-card-loading" role="status">更新中…</span>}</header>
    {error && <p className="analytics-card-error" role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    <div className="analytics-card-content">{children(data, loadedQuery)}</div>
    <footer className="analytics-card-footer">
      <DateRangeMenu label={title} {...data.range} disabled={busy} onChange={(start, end) => workspace.setRange(id, new URLSearchParams({ start, end }).toString())} />
      <a href={reportUrl(report, loadedQuery)} onClick={event => internalClick(event, () => workspace.navigate(report, loadedQuery))}>查看{reports[report].title}<ArrowRight size={13} /></a>
    </footer>
  </section>;
}
