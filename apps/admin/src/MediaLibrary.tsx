import { mediaKind } from '@weava/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { MediaGroups } from './MediaGroups.tsx';
import { LoadingState } from './LoadingState.tsx';
import type { MediaEditor } from './useMediaEditor.ts';
import type { useMediaLibrary } from './useMediaLibrary.ts';
export function MediaLibrary({
  library,
  editor,
  busy,
  onError,
  children,
}: {
  library: ReturnType<typeof useMediaLibrary>;
  editor: Pick<MediaEditor, 'mutateSelection' | 'choose'>;
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
    checked,
    setChecked,
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
  const [moveTo, setMoveTo] = useState(''),
    [managingGroups, setManagingGroups] = useState(false);
  useEffect(() => setFeedback(''), [searchTerm, kind, page, archived]);
  const mark = async () => {
    setSaving(true);
    try {
      await editor.mutateSelection(result.items.filter(row => checked.includes(row.id)), items =>
        api('media/archive', {items, archived: !archived}));
    } catch (error: any) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="media-filters">
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
        <select
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
        </select>
        <button onClick={() => setManagingGroups(true)}>管理分组</button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
          />
          已归档
        </label>
        {checked.length > 0 && (
          <button disabled={saving || busy} onClick={() => void mark()}>{archived ? '恢复所选' : '归档所选'}</button>
        )}
      </div>
      {checked.length > 0 && (
        <div className="media-filters">
          <select
            aria-label="移动所选到分组"
            value={moveTo}
            onChange={(event) => setMoveTo(event.target.value)}
          >
            <option value="">选择目标分组</option>
            <option value="__ungrouped__">未分组</option>
            {groups
              .filter((row) => !row.value.archived)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.value.label}
                </option>
              ))}
          </select>
          <button
            disabled={!moveTo || saving || busy}
            onClick={async () => {
              setSaving(true);
              try {
                await editor.mutateSelection(result.items.filter(row => checked.includes(row.id)), items =>
                  api('media/move', {items, groupId: moveTo === '__ungrouped__' ? null : moveTo}));
                setFeedback('媒体分组已更新');
              } catch (error: any) {
                onError(error.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            移动所选
          </button>
        </div>
      )}
      {managingGroups && (
        <MediaGroups
          rows={groups}
          refresh={refresh}
          close={() => setManagingGroups(false)}
          onError={onError}
        />
      )}
      {feedback && <p role="status">{feedback}</p>}
      {loading && <LoadingState label="读取媒体列表" />}
      {!loading && !result.total && (
        <p role="status">
          {query || kind || archived
            ? '没有符合筛选条件的媒体。'
            : '媒体库还是空的，可以上传第一个文件。'}
        </p>
      )}
      <div className="media-workspace">
        <div>
          <div className="media-grid" aria-busy={loading}>
            {result.items.map((row: any) => (
              <article key={row.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    aria-label={'选择 ' + row.value.name}
                    checked={checked.includes(row.id)}
                    onChange={(event) =>
                      setChecked(
                        event.target.checked
                          ? [...checked, row.id]
                          : checked.filter((id) => id !== row.id),
                      )
                    }
                  />
                </label>
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
                <small>{(row.value.bytes / 1024).toFixed(1)} KB</small>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(row.value.url);
                      setFeedback('地址已复制');
                    } catch {
                      onError('无法复制地址，请检查浏览器的剪贴板权限。');
                    }
                  }}
                >
                  复制地址
                </button>
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
