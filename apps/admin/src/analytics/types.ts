import type { AnalyticsReport } from '@weava/contracts';
import type { AnalyticsController } from './useAnalyticsReport.ts';
export type AnalyticsView = Omit<AnalyticsController, 'data'> & {
  data: AnalyticsReport;
  openVisitor: (id: string) => void;
  onError: (message: string) => void;
};
