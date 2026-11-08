import { useRef, useState } from 'react';
import { api } from './api.ts';
import { allowFileDrop, hasDroppedFiles, UploadStatus, useFileUploads } from './file-drop.tsx';
import { MediaDetails } from './MediaDetails.tsx';
import { MediaLibrary } from './MediaLibrary.tsx';
import { useMediaEditor } from './useMediaEditor.ts';
import { useMediaLibrary } from './useMediaLibrary.ts';

export default function MediaManager({
  onError,
  onOpen,
}: {
  onError: (message: string) => void;
  onOpen: (id: string) => void;
}) {
  const library = useMediaLibrary(onError),
    editor = useMediaEditor(library.refresh, onError);
  const [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false);
  const uploads = useFileUploads(false),
    fileInput = useRef<HTMLInputElement>(null);
  function uploadFiles(files: File[]) {
    if (busy) {
      onError('请等待当前裁切完成后上传。');
      return;
    }
    const destination = library.group;
    uploads.upload(
      files,
      async (row) => {
        if (destination && destination !== '__ungrouped__') {
          const [moved] = await api('media/move', {
            items: [{ id: row.id, revision: row.revision }],
            groupId: destination,
          });
          editor.receive(moved);
        }
        library.refresh();
      },
      editor.flush,
    );
  }
  return (
    <div
      className={'panel media-panel' + (dragging ? ' is-file-dragging' : '')}
      onDragOver={(event) => {
        if (allowFileDrop(event)) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="panel-title">
        <h1>媒体</h1>
        <button
          className="primary"
          disabled={busy || uploads.busy}
          onClick={() => fileInput.current?.click()}
        >
          上传文件
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void uploadFiles(files);
          }}
        />
      </div>
      <UploadStatus uploads={uploads} omitLabel="取消这些上传" />
      <MediaLibrary library={library} editor={editor} busy={busy} onError={onError}>
        <MediaDetails
          editor={editor}
          groups={library.groups}
          busy={busy}
          onBusy={setBusy}
          onError={onError}
          onOpen={onOpen}
        />
      </MediaLibrary>
    </div>
  );
}
