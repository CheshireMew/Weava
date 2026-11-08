import { mediaKind } from '@weava/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { AutosaveStatus } from './AutosaveStatus.tsx';
import { imagePoint as point } from './media-geometry.ts';
import type { MediaGroup, MediaReferences } from './media-models.ts';
import { MediaCrop } from './MediaCrop.tsx';
import type { MediaEditor } from './useMediaEditor.ts';
export function MediaDetails({
  editor,
  groups,
  busy,
  onBusy,
  onError,
  onOpen,
}: {
  editor: MediaEditor;
  groups: MediaGroup[];
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onOpen: (id: string) => void;
}) {
  const { selected, setSelected } = editor;
  const details = useRef<HTMLElement>(null);
  const [references, setReferences] = useState<MediaReferences | null>(null);
  useEffect(() => {
    setReferences(null);
    if (!selected) return;
    if (window.matchMedia('(max-width: 900px)').matches)
      details.current?.scrollIntoView({ block: 'start' });
    let active = true;
    api(`media/references?id=${encodeURIComponent(selected.id)}`)
      .then((value) => {
        if (active) setReferences(value);
      })
      .catch((error) => onError(error.message));
    return () => {
      active = false;
    };
  }, [selected?.id]);
  const isImage = selected && mediaKind(selected.value.url) === 'image';
  if (!selected) return null;
  return (
    <aside ref={details} className="media-details">
      <div className="modal-title">
        <h2>媒体信息</h2>
        <button disabled={busy} onClick={() => void editor.choose(null)}>
          关闭
        </button>
      </div>
      <label>
        名称
        <input
          value={selected.value.name}
          onChange={(event) =>
            setSelected({ ...selected, value: { ...selected.value, name: event.target.value } })
          }
        />
      </label>
      <label>
        分组
        <select
          aria-label="媒体所属分组"
          value={selected.value.groupId ?? ''}
          onChange={(event) =>
            setSelected({
              ...selected,
              value: { ...selected.value, groupId: event.target.value || null },
            })
          }
        >
          <option value="">未分组</option>
          {groups
            .filter((row) => !row.value.archived || row.id === selected.value.groupId)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.value.label}
                {row.value.archived ? '（已归档）' : ''}
              </option>
            ))}
        </select>
      </label>
      {isImage && (
        <>
          <label>
            图片说明
            <input
              value={selected.value.alt ?? ''}
              onChange={(event) =>
                setSelected({ ...selected, value: { ...selected.value, alt: event.target.value } })
              }
            />
          </label>
          <label>
            图注
            <textarea
              value={selected.value.caption ?? ''}
              onChange={(event) =>
                setSelected({
                  ...selected,
                  value: { ...selected.value, caption: event.target.value },
                })
              }
            />
          </label>
        </>
      )}
      <AutosaveStatus state={editor.autoSave} label="媒体信息" />
      {isImage && (
        <section>
          <div className="media-image-heading">
            <h3>图片焦点</h3>
            <MediaCrop
              key={selected.id}
              selected={selected}
              save={editor.save}
              onSaved={editor.accept}
              onError={onError}
              onBusy={onBusy}
            />
          </div>
          <div
            className="image-focus"
            role="slider"
            aria-label="图片焦点"
            tabIndex={0}
            aria-valuetext={
              '横向 ' +
              (selected.value.focalPoint?.x ?? 50) +
              '%，纵向 ' +
              (selected.value.focalPoint?.y ?? 50) +
              '%'
            }
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setSelected({ ...selected, value: { ...selected.value, focalPoint: point(event) } });
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1)
                setSelected({
                  ...selected,
                  value: { ...selected.value, focalPoint: point(event) },
                });
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const focus = { x: 50, y: 50, ...selected.value.focalPoint };
              const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 'x' : 'y';
              focus[axis] = Math.max(
                0,
                Math.min(
                  100,
                  focus[axis] + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 5 : -5),
                ),
              );
              setSelected({ ...selected, value: { ...selected.value, focalPoint: focus } });
            }}
          >
            <img src={selected.value.url} alt="点击图片选择裁切时保留的位置" draggable={false} />
            <span
              style={{
                left: (selected.value.focalPoint?.x ?? 50) + '%',
                top: (selected.value.focalPoint?.y ?? 50) + '%',
              }}
            />
          </div>
        </section>
      )}
      {references && (
        <section>
          <h3>引用位置</h3>
          {references.working.map((entry: any) => (
            <button key={entry.id} onClick={() => onOpen(entry.id)}>
              {entry.title}
            </button>
          ))}
          {!references.working.length && <p>当前工作稿未引用</p>}
          {references.layouts.map((layout: any) => (
            <p key={layout.id}>布局：{layout.label}</p>
          ))}
          {references.settings && <p>网站设置</p>}
          <p>
            公开内容 {references.published.length} · 历史修订 {references.historicalRevisions}
          </p>
        </section>
      )}
    </aside>
  );
}
