import { mediaKind } from '@weava/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { MediaGroups } from './MediaGroups.tsx';
import { LoadingState } from './LoadingState.tsx';
import type { MediaEditor } from './useMediaEditor.ts';
import type { useMediaLibrary } from './useMediaLibrary.ts';
import type { MediaRecord } from './media-models.ts';
import { Copy, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Popover } from './Popover.tsx';
import { MediaDeleteDialog } from './MediaDeleteDialog.tsx';
export function MediaLibrary({
  library,
  editor,
  busy,
  onError,
  children,
}: {
  library: ReturnType<typeof useMediaLibrary>;
  editor: Pick<MediaEditor, 'mutateSelection' | 'choose' | 'remove'>;
  busy: boolean;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const {
    query,
    setQuery,
    kind,
    setKind,
    page,
    setPage,
    archived,
    setArchived,
    group,
    setGroup,
    groups,
    result,
    loading,
    refresh,
    searchTerm,
  } = library;
  const [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState('');
  const [managingGroups, setManagingGroups] = useState(false);
  const [deleting, setDeleting] = useState<MediaRecord | null>(null);
  useEffect(() => setFeedback(''), [searchTerm, kind, page, archived]);
  const restore = async (row: MediaRecord) => {
    setSaving(true);
    try {
      await editor.mutateSelection([row], items =>
        api('media/archive', {items, archived: false}));
      setFeedback('媒体已恢复');
    } catch (error: any) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  };
  async function remove(row: MediaRecord) {
    const {cleanupPending} = await editor.remove(row);
    setFeedback(cleanupPending ? '媒体已删除，暂时被占用的文件将在下次启动时重试清理。' : '媒体已删除');
    setDeleting(null);
  }
  return (
    <>
      <div className="media-filters">
        {archived&&<button onClick={()=>{setArchived(false);setPage(1);}}>返回媒体库</button>}
        <input
          aria-label="搜索媒体库"
          placeholder="搜索媒体"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="媒体类型"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
          <option value="file">附件</option>
        </select>
        {groups.some(row=>!row.value.archived)||group ? <select
          aria-label="媒体分组筛选"
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部分组</option>
          <option value="__ungrouped__">未分组</option>
          {groups.map((row) => (
            <option key={row.id} value={row.id}>
              {row.value.label}
              {row.value.archived ? '（已归档）' : ''}
            </option>
          ))}
        </select> : null}
        <Popover label="更多媒体操作" className="media-actions-menu" menu trigger={<MoreHorizontal size={18} aria-hidden="true" />}>
          <button role="menuitem" onClick={()=>setManagingGroups(true)}>管理分组</button>
          {!archived&&<button role="menuitem" onClick={()=>{setArchived(true);setGroup('');setPage(1);}}>查看已归档媒体</button>}
        </Popover>
      </div>
      {managingGroups && (
        <MediaGroups
          rows={groups}
          refresh={refresh}
          close={() => setManagingGroups(false)}
          onError={onError}
        />
      )}
      {deleting && <MediaDeleteDialog key={deleting.id} row={deleting} onClose={() => setDeleting(null)} onDelete={remove} />}
      {feedback && <p role="status">{feedback}</p>}
      {loading && <LoadingState label="读取媒体列表" />}
      {!loading && !result.total && (
        <p role="status">
          {query || kind || group
            ? '没有符合条件的媒体。'
            : archived ? '暂无已归档媒体。' : '暂无媒体，可上传文件添加。'}
        </p>
      )}
      <div className="media-workspace">
        <div>
          <div className="media-grid" aria-busy={loading}>
            {result.items.map(row => (
              <article key={row.id}>
                <button
                  className="media-open"
                  disabled={busy || saving || loading}
                  onClick={() => void editor.choose(row)}
                >
                  {mediaKind(row.value.url) === 'image' ? (
                    <img
                      src={row.value.derivatives?.[0]?.url ?? row.value.url}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span>文件</span>
                  )}
                  <strong>{row.value.name}</strong>
                </button>
                <div className="media-card-footer">
                  <small>{(row.value.bytes / 1024).toFixed(1)} KB</small>
                  <div className="media-card-actions">
                    <button
                      type="button"
                      aria-label="复制地址"
                      title="复制地址"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(row.value.url);
                          setFeedback('地址已复制');
                        } catch {
                          onError('无法复制地址，请检查浏览器的剪贴板权限。');
                        }
                      }}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                    {archived && <button type="button" aria-label="恢复媒体" title="恢复媒体" disabled={saving || busy || loading} onClick={() => void restore(row)}>
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>}
                    <button type="button" className="media-delete-button" aria-label="删除媒体" title="删除媒体"
                      disabled={saving || busy || loading} onClick={() => setDeleting(row)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {(result.pages > 1 || page > 1) && (
            <nav className="library-pagination">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                上一页
              </button>
              <span>
                {page} / {result.pages}
              </span>
              <button disabled={page >= result.pages} onClick={() => setPage((value) => value + 1)}>
                下一页
              </button>
            </nav>
          )}
        </div>
        {children}
      </div>{' '}
    </>
  );
}
