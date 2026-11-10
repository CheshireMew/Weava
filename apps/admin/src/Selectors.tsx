import type { FieldDefinition } from '@weava/contracts';
import { mediaKind } from '@weava/contracts';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog.tsx';
import { MediaUploadList, startMediaUploads, useMediaUploads } from './media-uploads.tsx';
import { useDebouncedValue } from './useDebouncedValue.ts';
import { useAdminQuery } from './useAdminQuery.ts';
import { LoadingState } from './LoadingState.tsx';
import { useMediaOptimizationRefresh } from './useMediaLibrary.ts';

export interface SelectedMedia {
  id: string;
  url: string;
  name: string;
  alt?: string;
  caption?: string;
  kind: 'image' | 'video' | 'audio' | 'file';
}
export interface SelectedContent {
  id: string;
  title: string;
  path: string;
}

type ReferenceOptions = Pick<FieldDefinition, 'referenceTypes' | 'referenceFilters'>;
type Picker = {
  type: 'media' | 'content';
  kind?: string;
  reference?: ReferenceOptions;
  resolve: (value: any) => void;
};
const Context = createContext<{
  media: (kind?: string, groupId?: string) => Promise<SelectedMedia | null>;
  content: (options?: ReferenceOptions) => Promise<SelectedContent | null>;
} | null>(null);
export function useSelectors() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing selector provider');
  return value;
}
const kindOf = mediaKind;

export function SelectorsProvider({ children }: { children: ReactNode }) {
  const [picker, setPicker] = useState<Picker | null>(null),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const uploads = useMediaUploads();
  const [addressOpen, setAddressOpen] = useState(false),
    [address, setAddress] = useState(''),
    [addressError, setAddressError] = useState('');
  const searchTerm = useDebouncedValue(q);
  const [group, setGroup] = useState('');
  const groupQuery = useAdminQuery<any[]>(picker?.type === 'media' ? 'media/groups' : null);
  const groups = groupQuery.data ?? [];
  const fileInput = useRef<HTMLInputElement>(null),
    pending = useRef<Picker | null>(null);
  useEffect(
    () => () => {
      pending.current?.resolve(null);
    },
    [],
  );
  const open = (
    type: Picker['type'],
    kind?: string,
    reference?: ReferenceOptions,
    initialGroup?: string,
  ) =>
    new Promise<any>((resolve) => {
      pending.current?.resolve(null);
      const next = { type, kind, reference, resolve };
      pending.current = next;
      setPicker(next);
      setAddressOpen(false);
      setGroup(initialGroup ?? '');
      setQ('');
      setPage(1);
      setError('');
    });
  const finish = (value: any) => {
    pending.current?.resolve(value);
    pending.current = null;
    setAddressOpen(false);
    setPicker(null);
  };
  const params = () =>
    new URLSearchParams({
      q: searchTerm,
      page: String(page),
      pageSize: '18',
      ...(picker?.type === 'media' && group ? { group } : {}),
      ...(picker?.kind ? { kind: picker.kind } : {}),
      ...(picker?.reference?.referenceTypes
        ? { types: picker.reference.referenceTypes.join(',') }
        : {}),
      ...(picker?.reference?.referenceFilters
        ? { filters: JSON.stringify(picker.reference.referenceFilters) }
        : {}),
    });
  const query = useAdminQuery<any>(picker ? `${picker.type === 'media' ? 'media/query?' : picker.reference ? 'references/query?' : 'entries/query?'}${params()}` : null);
  const result = query.data ?? { items: [], total: 0, pages: 0 }, loading = query.loading;
  useMediaOptimizationRefresh(result.items, query.refresh);
  useEffect(() => { setError(query.error || groupQuery.error); }, [query.error, groupQuery.error]);
  const uploadItems = uploads.filter(item => (!picker?.kind || mediaKind(item.name) === picker.kind)
    && (!group || (group === '__ungrouped__' ? !item.groupId : item.groupId === group))
    && item.name.toLowerCase().includes(searchTerm.toLowerCase())
    && (item.status !== 'complete' || page === 1 && !result.items.some((row: any) => row.id === item.row?.id)));
  const uploadFiles = (files: File[]) => startMediaUploads(files, group && group !== '__ungrouped__' ? group : undefined);
  const title = picker?.type === 'media' ? '选择媒体' : '选择内容';
  return (
    <Context.Provider
      value={{
        media: (kind, groupId) => open('media', kind, undefined, groupId),
        content: (options) => open('content', undefined, options),
      }}
    >
      {children}
      {picker && (
        <Dialog
          className="asset-dialog"
          label={title}
          onClose={() => finish(null)}
          onPaste={event => {
            if (picker.type !== 'media' || addressOpen || picker.kind && picker.kind !== 'image') return;
            const clipboard = event.clipboardData;
            const files = Array.from(clipboard.files);
            if (!files.length) for (const item of Array.from(clipboard.items)) {
              if (item.kind !== 'file') continue;
              const file = item.getAsFile();
              if (file) files.push(file);
            }
            const images = files.filter(file => file.type.startsWith('image/') || mediaKind(file.name) === 'image');
            if (!images.length) return;
            event.preventDefault();
            event.stopPropagation();
            uploadFiles(images);
          }}
        >
          <div className="modal-title">
            <h2>{title}</h2>
            <div className="dialog-actions">
              {picker.type === 'media' && (
                <button
                  onClick={() => {
                    setAddress('');
                    setAddressError('');
                    setAddressOpen(true);
                  }}
                >
                  粘贴网址
                </button>
              )}
              <button onClick={() => finish(null)}>
                关闭
              </button>
            </div>
          </div>
          <div className="selector-toolbar">
            {picker.type === 'media' && (
              <>
                <button onClick={() => fileInput.current?.click()}>
                  上传文件
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  accept={picker.kind === 'image' ? 'image/*' : undefined}
                  onChange={(event) => {
                    uploadFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
              </>
            )}
            <input
              data-autofocus
              aria-label={picker.type === 'media' ? '搜索媒体' : '查找内容'}
              placeholder="搜索"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
            />
            {picker.type === 'media' && (
              <select
                aria-label="选择器媒体分组"
                value={group}
                onChange={(event) => {
                  setGroup(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部分组</option>
                <option value="__ungrouped__">未分组</option>
                {groups
                  .filter((row) => !row.value.archived)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.value.label}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <div className="selector-results">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {picker.type === 'media' && <MediaUploadList items={uploadItems} select={row => finish({ ...row.value, id: row.id, kind: kindOf(row.value.url) })} />}
          {loading && <LoadingState label="读取可选内容" />}
          <div
            className={picker.type === 'media' ? 'selector-media' : 'selector-content'}
            aria-busy={loading}
          >
            {result.items.map((row: any) => (
              <button
                key={row.id}
                className="selector-item"
                disabled={loading}
                onClick={async () => {
                  if (picker.type !== 'media') {
                    finish({ id: row.id, title: row.value.title, path: row.value.path });
                    return;
                  }
                  try {
                    let url = row.value.url;
                    finish({ ...row.value, url, kind: kindOf(url) });
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                {picker.type === 'media' && kindOf(row.value.url) === 'image' && (
                  <img
                    src={row.value.derivatives?.[0]?.url ?? row.value.url}
                    alt=""
                    loading="lazy"
                    width="240"
                    height="160"
                  />
                )}
                <strong>{row.value.name ?? row.value.title}</strong>
                {picker.type === 'content' && <small>{row.value.path}</small>}
              </button>
            ))}
          </div>
          {!loading && !error && !result.total && (
            <p role="status">
              {q
                ? '没有匹配的内容，请换个关键词。'
                : picker.type === 'media'
                  ? '媒体库还是空的，可以上传第一个文件。'
                  : '还没有可以引用的内容。'}
            </p>
          )}
          </div>
          {result.pages > 1 && (
            <nav className="library-pagination" aria-label={title + '分页'}>
              <button disabled={loading || page <= 1} onClick={() => setPage((page) => page - 1)}>
                上一页
              </button>
              <span>
                {page} / {result.pages}
              </span>
              <button
                disabled={loading || page >= result.pages}
                onClick={() => setPage((page) => page + 1)}
              >
                下一页
              </button>
            </nav>
          )}
          {addressOpen && (
            <Dialog label="粘贴媒体网址" onClose={() => setAddressOpen(false)}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const url = address.trim();
                  if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) {
                    setAddressError('请填写完整的网址，或以 / 开头的站内地址。');
                    return;
                  }
                  try {
                    const parsed = new URL(url, window.location.origin);
                    const kind = ['image', 'video', 'audio', 'file'].includes(picker.kind ?? '')
                      ? (picker.kind as SelectedMedia['kind'])
                      : kindOf(parsed.pathname);
                    finish({
                      id: '',
                      url,
                      name: decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname),
                      kind,
                    });
                  } catch {
                    setAddressError('这个网址无法识别，请检查后重试。');
                  }
                }}
              >
                <h2>粘贴媒体网址</h2>
                <label>
                  网址
                  <input
                    data-autofocus
                    required
                    aria-label="媒体网址"
                    value={address}
                    onChange={(event) => {
                      setAddress(event.target.value);
                      setAddressError('');
                    }}
                    placeholder="https://"
                  />
                </label>
                {addressError && (
                  <p role="alert" className="error">
                    {addressError}
                  </p>
                )}
                <div className="dialog-actions">
                  <button type="button" onClick={() => setAddressOpen(false)}>
                    取消
                  </button>
                  <button type="submit">使用此网址</button>
                </div>
              </form>
            </Dialog>
          )}
        </Dialog>
      )}
    </Context.Provider>
  );
}
