import {Card} from './Card.tsx';
import {TrafficChart,SourcesChart} from './ReportContent.tsx';
import type {AnalyticsView} from './types.ts';
export function AnalyticsTrends({model,section='overview'}:{section?:'overview'|'sources';model:Pick<AnalyticsView,'data'|'openVisitor'>}){
  return section==='overview'?<Card title="流量趋势"><TrafficChart data={model.data}/></Card>:<Card title="搜索与 AI 来源趋势"><SourcesChart data={model.data}/></Card>;
}
