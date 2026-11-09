import { useEffect, useRef, useState } from 'react';
import { allowFileDrop, hasDroppedFiles } from './file-drop.tsx';
import { MediaUploadList, startMediaUploads, useMediaUploads } from './media-uploads.tsx';
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
  const uploads = useMediaUploads(),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    for (const item of uploads) if (item.row) editor.receiveUpload(item.row);
    const current = library.result.items.find(row => row.id === editor.selected?.id);
    if (current && current.revision >= (editor.selected?.revision ?? 0)) editor.receive(current);
  }, [uploads, library.result.items, editor.selected]);
  function uploadFiles(files: File[]) {
    const destination = library.group;
    startMediaUploads(files, destination && destination !== '__ungrouped__' ? destination : undefined);
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
      <MediaUploadList items={uploads.filter(item => item.status !== 'complete')} />
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
