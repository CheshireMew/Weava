import { isUploadFormat, mediaKind, mediaUploadMaxBytes } from '@weava/contracts';
import { useEffect, useRef, useState } from 'react';
import { usePendingEditWork } from './EditSessions.tsx';
import { uploadFile } from './upload-file.ts';
import { connectionFailure, retryConnection } from './connection-recovery.ts';

export function hasDroppedFiles(data: DataTransfer | null) {
  return !!data && (Array.from(data.types).includes('Files') || data.files.length > 0);
}
export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files);
  if (!files.length) for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files.filter(file => file.type.startsWith('image/') || mediaKind(file.name) === 'image');
}
export function selectionRange(doc: Document, root: HTMLElement) {
  const selection = doc.defaultView?.getSelection();
  if (selection?.rangeCount && root.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    return range;
  }
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
}
export function allowFileDrop(event: Pick<DragEvent, 'dataTransfer' | 'preventDefault'>) {
  if (!hasDroppedFiles(event.dataTransfer)) return false;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
  return true;
}
/** caretPositionFromPoint and caretRangeFromPoint cover current Firefox and Chromium/WebKit. */
export function dropRange(doc: Document, root: HTMLElement, x: number, y: number) {
  const point = (doc as any).caretPositionFromPoint?.(x, y);
  let range: Range | null = (doc as any).caretRangeFromPoint?.(x, y) ?? null;
  if (point) {
    range = doc.createRange();
    range.setStart(point.offsetNode, point.offset);
    range.collapse(true);
  }
  if (range && root.contains(range.startContainer)) {
    range.collapse(true);
    return range;
  }
  const selection = doc.defaultView?.getSelection();
  if (selection?.rangeCount && root.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    return range;
  }
  range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
}
type Insert = (row: any, file: File) => void | Promise<void>;
interface FailedUpload {
  file: File;
  insert: Insert;
  prepare?: () => Promise<unknown>;
  row?: any;
  error: string;
  retryable?: boolean;
  attempts?: number;
}
export function useFileUploads(imagesOnly = true) {
  const [progress, setProgress] = useState(''),
    [failed, setFailed] = useState<FailedUpload[]>([]),
    [busy, setBusy] = useState(false);
  const active = useRef<Promise<void> | null>(null),
    failure = useRef<Promise<void> | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  usePendingEditWork(() => active.current ?? failure.current);
  const run = (items: FailedUpload[]) => {
    if (mounted.current) setBusy(true);
    const previous = active.current;
    const task = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let batchFailed = false;
        for (const [index, item] of items.entries()) {
          try {
            if (!isUploadFormat(item.file.name, imagesOnly))
              throw new Error(
                imagesOnly ? '请选择 PNG、JPG、WebP、GIF 或 AVIF 图片。' : '不支持这个文件格式。',
              );
            if (!item.file.size || item.file.size > mediaUploadMaxBytes)
              throw new Error('文件大小需要在 32 MB 以内。');
            if (mounted.current)
              setProgress(`${index + 1}/${items.length} ${item.file.name}：正在上传…`);
            if (item.prepare) {
              await item.prepare();
              item.prepare = undefined;
            }
            item.row ??= await uploadFile(item.file, (message) => {
              if (mounted.current)
                setProgress(`${index + 1}/${items.length} ${item.file.name}：${message}`);
            });
            if (mounted.current) await item.insert(item.row, item.file);
          } catch (error: any) {
            batchFailed = true;
            failure.current = Promise.reject(new Error('有文件尚未上传，请先重试或取消这些文件。'));
            void failure.current.catch(() => {});
            if (mounted.current)
              setFailed((old) => [
                ...old,
                { ...item, error: error.message, retryable: connectionFailure(error), attempts: (item.attempts ?? 0) + 1 },
                ...items
                  .slice(index + 1)
                  .map((next) => ({ ...next, error: '等待前一个文件重试。' })),
              ]);
            // Keep the remaining files at the same insertion point so retry preserves their order.
            break;
          }
        }
        if (batchFailed) await failure.current;
      })
      .finally(() => {
        if (active.current === task) {
          active.current = null;
          if (mounted.current) {
            setProgress('');
            setBusy(false);
          }
        }
      });
    active.current = task;
    void task.catch(() => {});
  };
  const retry = () => {
    if (active.current) return;
    const items = failed;
    failure.current = null;
    setFailed([]);
    if (items.length) run(items);
  };
  useEffect(() => {
    if (!busy && failed[0]?.retryable)
      return retryConnection(retry, (failed[0].attempts ?? 1) - 1);
  }, [failed, busy]);
  return {
    progress,
    failed,
    busy,
    upload: (files: File[], insert: Insert, prepare?: () => Promise<unknown>) => {
      if (files.length) run(files.map((file) => ({ file, insert, prepare, error: '' })));
    },
    retry,
    ignore: () => {
      failure.current = null;
      setFailed([]);
    },
  };
}
export function UploadStatus({
  uploads,
  omitLabel = '不插入这些文件',
}: {
  uploads: ReturnType<typeof useFileUploads>;
  omitLabel?: string;
}) {
  return (
    <>
      {uploads.progress && (
        <p className="file-upload-status" role="status">
          {uploads.progress}
        </p>
      )}
      {uploads.failed.length > 0 && (
        <div className="file-upload-error" role="alert">
          <span>{uploads.failed.map((item) => `${item.file.name}：${item.error}`).join('；')}</span>
          <button type="button" disabled={uploads.busy} onClick={uploads.retry}>
            重试上传
          </button>
          <button type="button" disabled={uploads.busy} onClick={uploads.ignore}>
            {omitLabel}
          </button>
        </div>
      )}
    </>
  );
}
