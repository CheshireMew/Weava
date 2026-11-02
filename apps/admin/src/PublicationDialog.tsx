import { Dialog } from './Dialog.tsx';
import type { PublicationController } from './usePublication.ts';
export function PublicationDialog({
  model,
  error,
  onPublished,
}: {
  model: PublicationController;
  error: string;
  onPublished: () => Promise<void>;
}) {
  const { publication, setPublication, busy, task } = model;
  return (
    <>
      {' '}
      {publication && (
        <Dialog label="发布变更" onClose={() => setPublication(null)} dismissible={!busy}>
          <div className="modal-title">
            <h2>发布变更</h2>
            <button disabled={busy} onClick={() => setPublication(null)}>
              关闭
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {publication.settingsChanged && <p>网站设置</p>}
          {publication.layoutsChanged && <p>页面模板与共享区域</p>}
          {publication.routesChanged && <p>网址别名</p>}
          {publication.termsChanged && <p>分类与标签</p>}
          {publication.entries.map((entry: any) => (
            <p key={entry.id}>
              {entry.action === 'add' ? '新增' : '更新'} · {entry.title}
              <small>{entry.path}</small>
            </p>
          ))}
          {publication.removed.map((entry: any) => (
            <p key={entry.id}>撤下 · {entry.title}</p>
          ))}
          {!publication.settingsChanged &&
            !publication.layoutsChanged &&
            !publication.routesChanged &&
            !publication.termsChanged &&
            !publication.entries.length &&
            !publication.removed.length && <p>没有需要发布的修改。</p>}
          <button
            className="primary"
            disabled={
              busy ||
              (!publication.settingsChanged &&
                !publication.layoutsChanged &&
                !publication.routesChanged &&
                !publication.termsChanged &&
                !publication.entries.length &&
                !publication.removed.length)
            }
            onClick={async () => {
              const result = await task('publish', publication.options, true);
              if (result) {
                setPublication(null);
                await onPublished();
              }
            }}
          >
            {busy ? '正在发布…' : '确认发布'}
          </button>
        </Dialog>
      )}
    </>
  );
}
