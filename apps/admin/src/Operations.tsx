import { Suspense } from 'react';
import { retryableLazy as lazy } from './ErrorBoundary.tsx';
import { PanelSections } from './PanelSections.tsx';
import { LoadingState } from './LoadingState.tsx';
import BackupManager from './BackupManager.tsx';

const ImportManager = lazy(() => import('./ImportManager.tsx'));

export default function Operations({ contentEnabled, refresh, onError }: {
  contentEnabled: boolean;
  refresh: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const backup = <BackupManager onError={onError}/>;
  return <div className="panel operations-panel">
    <div className="panel-title"><h1>{contentEnabled?'备份与迁移':'备份'}</h1></div>
    {contentEnabled ? <PanelSections label="备份与迁移" segmented sections={[
      { id: 'backup', label: '备份', content: backup },
      { id: 'import', label: '导入与导出', content: <Suspense fallback={<LoadingState label="载入导入工具"/>}><ImportManager refresh={refresh}/></Suspense> },
    ]}/> : backup}
  </div>;
}
