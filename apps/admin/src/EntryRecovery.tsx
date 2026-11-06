import type { EntryRecoveryModel } from './content-models.ts';
export function EntryRecovery({ model }: { model: EntryRecoveryModel }) {
  const { record, draftNotice, conflictPaused, restoreLocal, recoveryCopies, setError } = model;
  if (!record) return null;
  const attempt = (action: () => Promise<void>) =>
    void action().catch((error) => setError(error.message));
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
          <button onClick={() => attempt(model.compare)}>比较并解决</button>
        </div>
      )}
      {restoreLocal && (
        <div className="recovery-banner">
          这篇文章有尚未保存的本地草稿。
          {recoveryCopies.length > 1 && (
            <select
              aria-label="选择要恢复的草稿"
              value={Math.max(
                0,
                recoveryCopies.findIndex((copy) => copy.record === restoreLocal),
              )}
              onChange={(event) => model.chooseCopy(Number(event.target.value))}
            >
              {recoveryCopies.map((copy, index) => (
                <option key={(copy.sessionId ?? 'legacy') + index} value={index}>
                  {copy.record.value.title} · {new Date(copy.updatedAt).toLocaleString()}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => attempt(model.recoverSelected)}>恢复到编辑器</button>
          <button onClick={() => attempt(model.useServer)}>使用服务器版本</button>
        </div>
      )}
    </>
  );
}
