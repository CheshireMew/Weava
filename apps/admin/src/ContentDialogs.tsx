import { lazy, Suspense } from 'react';

import { api } from './api.ts';


import { Dialog } from './Dialog.tsx';

import type { ContentWorkspace } from './useContentWorkspace.ts';

const BulkEditor = lazy(() => import('./BulkEditor.tsx'));

const RevisionDialog = lazy(() =>
  import('./Revisions.tsx').then((module) => ({ default: module.RevisionDialog })),
);
const MergeDialog = lazy(() =>
  import('./Revisions.tsx').then((module) => ({ default: module.MergeDialog })),
);
export function ContentDialogs({ model }: { model: ContentWorkspace }) {
  const {
    record,
    session,
    conflict,
    setConflict,
    history,
    setHistory,
    preview,
    setPreview,
    narrow,
    setNarrow,
    adopt,
    showConflict,
    state,
    setError,
    notify,
    refresh,
    bulkIds,
    setBulkIds,
    bulkOpen,
    setBulkOpen,
    items,
  } = model;

  return (
    <>
      {bulkOpen && (
        <Suspense fallback={null}>
          <BulkEditor
            rows={items.filter((row: any) => bulkIds.includes(row.id))}
            types={state.types}
            terms={state.terms ?? []}
            close={() => setBulkOpen(false)}
            done={async () => {
              await refresh();
              if (record && bulkIds.includes(record.id)) adopt(await api(`entry/${record.id}`));
              setBulkIds([]);
            }}
          />
        </Suspense>
      )}
      {history && record && (
        <Suspense fallback={null}>
          <RevisionDialog
            id={record.id}
            history={history}
            onClose={() => setHistory(null)}
            onError={setError}
            onRestore={async (version) => {
              const row = await api('restore', {
                id: record.id,
                version,
                revision: record.revision,
              });
              adopt(row);
              setHistory(null);
              await refresh();
              notify('历史版本已恢复为工作稿，公开页面保持原版本。');
            }}
          />
        </Suspense>
      )}
      {conflict && (
        <Suspense fallback={null}>
          <MergeDialog
            plan={conflict}
            onClose={() => setConflict(null)}
            onError={setError}
            onRemote={() => adopt(conflict.remote)}
            onSave={async (choices) => {
              try {
                const row = await api('entry/merge/save', {
                  id: conflict.id,
                  baseRevision: conflict.base.revision,
                  currentRevision: conflict.remote.revision,
                  value: conflict.local,
                  choices,
                });
                adopt(row);
                await refresh();
                notify('已保存合并结果。');
              } catch (error: any) {
                if (error.status === 409 && session.record) await showConflict(session.record);
                throw error;
              }
            }}
          />
        </Suspense>
      )}
      {preview && (
        <Dialog className="preview-modal" label="实际页面预览" onClose={() => setPreview('')}>
          <div className="modal-title">
            <h2>实际页面预览</h2>
            <button aria-pressed={narrow} onClick={() => setNarrow(!narrow)}>
              {narrow ? '桌面宽度' : '窄屏宽度'}
            </button>
            <button onClick={() => setPreview('')}>关闭</button>
          </div>
          <iframe
            title="实际页面预览"
            src={preview}
            sandbox="allow-same-origin"
            style={{ width: narrow ? 390 : '100%' }}
          />
        </Dialog>
      )}
    </>
  );
}
