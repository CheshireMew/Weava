import { Suspense } from 'react';
import { retryableLazy as lazy } from './ErrorBoundary.tsx';
import { Dialog } from './Dialog.tsx';
import type { ContentDialogsModel } from './content-models.ts';
const BulkEditor = lazy(() => import('./BulkEditor.tsx'));
const RevisionDialog = lazy(() =>
  import('./Revisions.tsx').then((module) => ({ default: module.RevisionDialog })),
);
const MergeDialog = lazy(() =>
  import('./Revisions.tsx').then((module) => ({ default: module.MergeDialog })),
);
export function ContentDialogs({ model }: { model: ContentDialogsModel }) {
  const { bulk, history, conflict, preview, setError } = model;
  return (
    <>
      {bulk.open && (
        <Suspense fallback={null}>
          <BulkEditor
            rows={bulk.rows}
            types={bulk.types}
            terms={bulk.terms}
            close={bulk.close}
            done={bulk.done}
          />
        </Suspense>
      )}
      {history.items && history.record && (
        <Suspense fallback={null}>
          <RevisionDialog
            id={history.record.id}
            history={history.items}
            onClose={history.close}
            onError={setError}
            onRestore={history.restore}
          />
        </Suspense>
      )}
      {conflict.plan && (
        <Suspense fallback={null}>
          <MergeDialog
            plan={conflict.plan}
            onClose={conflict.close}
            onError={setError}
            onRemote={conflict.useRemote}
            onSave={conflict.save}
          />
        </Suspense>
      )}
      {preview.url && (
        <Dialog className="preview-modal" label="实际页面预览" onClose={preview.close}>
          <div className="modal-title">
            <h2>实际页面预览</h2>
            <button aria-pressed={preview.narrow} onClick={preview.toggle}>
              {preview.narrow ? '桌面宽度' : '窄屏宽度'}
            </button>
            <button onClick={preview.close}>关闭</button>
          </div>
          <iframe
            title="实际页面预览"
            src={preview.url}
            sandbox="allow-same-origin"
            style={{ width: preview.narrow ? 390 : '100%' }}
          />
        </Dialog>
      )}
    </>
  );
}
