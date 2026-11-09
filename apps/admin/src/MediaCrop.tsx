import { useEffect, useId, useState } from 'react';
import { api, waitJob } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { imagePoint as point } from './media-geometry.ts';
import type { MediaRecord } from './media-models.ts';
export function MediaCrop({
  selected,
  save,
  onSaved,
  onError,
  onBusy,
}: {
  selected: MediaRecord;
  save: () => Promise<MediaRecord>;
  onSaved: (row: MediaRecord) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [progress, setProgress] = useState('');
  useEffect(() => {
    onBusy(!!progress);
    return () => onBusy(false);
  }, [!!progress, onBusy]);
  const [crop, setCrop] = useState({ left: 0, top: 0, width: 100, height: 100 }),
    [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [cropping, setCropping] = useState(false),
    [cropError, setCropError] = useState('');
  const cropHelp = useId();
  const adjustCrop = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      progress ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setCrop((previous) => {
      if (event.key === 'Home') return { left: 0, top: 0, width: 100, height: 100 };
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const delta =
        (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) * (event.altKey ? 1 : 5);
      if (event.shiftKey) {
        const axis = horizontal ? 'width' : 'height',
          offset = horizontal ? previous.left : previous.top;
        return {
          ...previous,
          [axis]: Math.max(0.1, Math.min(100 - offset, previous[axis] + delta)),
        };
      }
      const axis = horizontal ? 'left' : 'top',
        size = horizontal ? previous.width : previous.height;
      return { ...previous, [axis]: Math.max(0, Math.min(100 - size, previous[axis] + delta)) };
    });
  };
  return (
    <>
      {
        <button
          disabled={!!progress}
          onClick={() => {
            setCrop({ left: 0, top: 0, width: 100, height: 100 });
            setCropError('');
            setCropping(true);
          }}
        >
          裁切图片
        </button>
      }
      {cropping && (
        <Dialog
          label="裁切图片"
          className="modal crop-dialog"
          onClose={() => setCropping(false)}
          dismissible={!progress}
        >
          <div className="modal-title">
            <h2>裁切图片</h2>
            <button disabled={!!progress} onClick={() => setCropping(false)}>
              关闭
            </button>
          </div>
          <p id={cropHelp}>拖动框选，或用方向键移动、Shift + 方向键调整大小。</p>
          <div
            className="crop-surface"
            role="group"
            aria-label="裁切选区"
            aria-describedby={cropHelp}
            aria-disabled={!!progress}
            tabIndex={0}
            onKeyDown={adjustCrop}
            onPointerDown={(event) => {
              if (progress) return;
              event.currentTarget.focus();
              const start = point(event);
              setAnchor(start);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (progress || !anchor) return;
              const end = point(event);
              setCrop({
                left: Math.min(anchor.x, end.x),
                top: Math.min(anchor.y, end.y),
                width: Math.max(0.1, Math.abs(end.x - anchor.x)),
                height: Math.max(0.1, Math.abs(end.y - anchor.y)),
              });
            }}
            onPointerUp={() => setAnchor(null)}
            onPointerCancel={() => setAnchor(null)}
            onLostPointerCapture={() => setAnchor(null)}
          >
            <img src={selected.value.url} width={selected.value.width} height={selected.value.height} alt="裁切预览" draggable={false} />
            <span
              style={{
                left: crop.left + '%',
                top: crop.top + '%',
                width: crop.width + '%',
                height: crop.height + '%',
              }}
            />
          </div>
          <p className="crop-description" role="status">
            左侧 {Math.round(crop.left)}%，上方 {Math.round(crop.top)}%，宽 {Math.round(crop.width)}
            %，高 {Math.round(crop.height)}%
          </p>
          <div className="crop-actions">
            <button
              type="button"
              disabled={!!progress}
              onClick={() => setCrop({ left: 0, top: 0, width: 100, height: 100 })}
            >
              重置选区
            </button>
            <button
              disabled={!!progress || (crop.width === 100 && crop.height === 100)}
              onClick={async () => {
                setProgress('正在保存裁切…');
                setCropError('');
                try {
                  const row = await save();
                  const job = await api('media/crop', { id: row.id, revision: row.revision, crop });
                  const complete = await waitJob(job, (job) => setProgress(job.message));
                  onSaved(complete.result);
                  setCropping(false);
                } catch (error: any) {
                  setCropError(error.message);
                  onError(error.message);
                } finally {
                  setProgress('');
                }
              }}
            >
              保存裁切图片
            </button>
          </div>
          {progress && <p role="status">{progress}</p>}
          {cropError && (
            <p role="alert" className="error">
              {cropError}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
