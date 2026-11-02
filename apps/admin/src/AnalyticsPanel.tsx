import { AnalyticsReportView } from './AnalyticsReportView.tsx';
import { useState } from 'react';
import { useAnalyticsReport } from './analytics/useAnalyticsReport.ts';
import { AnalyticsControls } from './analytics/AnalyticsControls.tsx';

import { VisitorDetails } from './analytics/VisitorDetails.tsx';

import './AnalyticsPanel.css';
export default function AnalyticsPanel({ onError }: { onError: (message: string) => void }) {
  const model = useAnalyticsReport(),
    { data, error, loading, load } = model;
  const [visitor, setVisitor] = useState<string | null>(null);
  const openVisitor = (id: string) => setVisitor(id);
  return (
    <div className="panel analytics-panel">
      <AnalyticsControls model={model} />
      {error && (
        <div className="analytics-error" role="alert">
          {error}
          <button onClick={() => load()}>重试</button>
        </div>
      )}
      {loading && !data && <p role="status">正在读取统计…</p>}
      {data && !error && (
        <AnalyticsReportView
          data={data}
          model={model}
          openVisitor={openVisitor}
          onError={onError}
        />
      )}
      {visitor && (
        <VisitorDetails key={visitor} visitor={visitor} setVisitor={setVisitor} data={data} />
      )}
    </div>
  );
}
