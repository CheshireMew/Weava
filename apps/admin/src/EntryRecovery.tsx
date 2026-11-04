import { api } from './api.ts';
import { drafts } from './draft-repository.ts';

import type { ContentWorkspace } from './useContentWorkspace.ts';

export function EntryRecovery({
  model,
}: {
  model: Pick<
    ContentWorkspace,
    | 'record'
    | 'setRecord'
    | 'session'
    | 'setEditorEpoch'
    | 'conflictPaused'
    | 'restoreLocal'
    | 'setRestoreLocal'
    | 'recoveryCopies'
    | 'setRecoveryCopies'
    | 'draftNotice'
    | 'setDraftNotice'
    | 'update'
    | 'adopt'
    | 'select'
    | 'showConflict'
    | 'setError'
  >;
}) {
  const {
    record,
    setRecord,
    session,
    setEditorEpoch,
    conflictPaused,
    restoreLocal,
    setRestoreLocal,
    setRecoveryCopies,
    draftNotice,
    setDraftNotice,
    update,
    adopt,
    showConflict,
    setError,
  } = model;
  if (!record) return null;
  return (
    <>
      {draftNotice && (
        <div className="recovery-banner" role="alert">
          {draftNotice}
        </div>
      )}
      {conflictPaused && (
        <div className="recovery-banner">
          本地修改尚未保存，服务器已有新版本。
          <button
            onClick={() => {
              if (session.record)
                showConflict(session.record).catch((error) => setError(error.message));
            }}
          >
            比较并解决
          </button>
        </div>
      )}
      {restoreLocal && (
        <div className="recovery-banner">
          这篇文章有尚未保存的本地草稿。
          <button
            onClick={async () => {
              const local = restoreLocal;
              try {
                await drafts().save(local);
              } catch (error: any) {
                setDraftNotice(error.message);
              }
              if (local.revision !== record.revision) {
                session.record = local;
                setRecord(local);
                await showConflict(local).catch((error) => setError(error.message));
              } else update(local.value);
              setEditorEpoch((v) => v + 1);
              setRestoreLocal(null);
            }}
          >
            恢复到编辑器
          </button>
          <button
            onClick={async () => {
              try {
                const server = await api(`entry/${encodeURIComponent(record.id)}`);
                adopt(server);
                setRecoveryCopies([]);
              } catch (error: any) {
                setError(error.message);
              }
            }}
          >
            使用服务器版本
          </button>
        </div>
      )}
    </>
  );
}
