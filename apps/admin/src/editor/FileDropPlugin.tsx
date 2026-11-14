import { useEffect, useRef } from 'react';
import { allowFileDrop, clipboardImages, dropRange, hasDroppedFiles, selectionRange, useFileUploads } from '../file-drop.tsx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $createRangeSelection,
  $getNodeByKey,
  $setSelection,
  $isRangeSelection,
  $getRoot,
  $insertNodes,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { MediaNode } from './nodes.tsx';

export function FileDropPlugin({ uploads }: { uploads: ReturnType<typeof useFileUploads> }) {
  const [editor] = useLexicalComposerContext(),
    latest = useRef(uploads);
  latest.current = uploads;
  useEffect(() => {
    let detach = () => {};
    const remove = editor.registerRootListener((root) => {
      detach();
      if (!root) return;
      const over = (event: DragEvent) => {
        if (allowFileDrop(event)) root.classList.add('is-file-dragging');
      };
      const leave = () => root.classList.remove('is-file-dragging');
      const upload = (files: File[], range: Range) => {
        let insertion: ReturnType<typeof $getSelection> = null;
        editor.update(
          () => {
            const selection = $createRangeSelection();
            selection.applyDOMRange(range);
            insertion = selection;
          },
          { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
        );
        latest.current.upload(files, (row) => {
          if (!editor.getRootElement()) throw new Error('正文已经切换，图片已保存在媒体库中。');
          editor.update(
            () => {
              const previous = $getSelection()?.clone() ?? null;
              if (
                $isRangeSelection(insertion) &&
                $getNodeByKey(insertion.anchor.key)?.isAttached() &&
                $getNodeByKey(insertion.focus.key)?.isAttached()
              )
                $setSelection(insertion);
              else $getRoot().selectEnd();
              $insertNodes([
                new MediaNode(
                  row.value.url,
                  row.value.alt ?? row.value.name,
                  'image',
                  undefined,
                  row.value.caption,
                ),
              ]);
              insertion = $getSelection()?.clone() ?? null;
              // Replacing an empty paragraph detaches its node before Lexical clears
              // it from the node map. Keep the new caret instead of restoring it there.
              if (
                $isRangeSelection(previous) &&
                $getNodeByKey(previous.anchor.key)?.isAttached() &&
                $getNodeByKey(previous.focus.key)?.isAttached()
              )
                $setSelection(previous);
            },
            { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
          );
        });
      };
      const drop = (event: DragEvent) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation(); leave();
        upload(Array.from(event.dataTransfer!.files), dropRange(root.ownerDocument, root, event.clientX, event.clientY));
      };
      const paste = (event: ClipboardEvent) => {
        const files = clipboardImages(event.clipboardData);
        if (!files.length) return;
        event.preventDefault(); event.stopPropagation();
        upload(files, selectionRange(root.ownerDocument, root));
      };
      root.addEventListener('dragover', over);
      root.addEventListener('dragleave', leave);
      root.addEventListener('drop', drop, true);
      root.addEventListener('paste', paste, true);
      detach = () => {
        root.removeEventListener('dragover', over);
        root.removeEventListener('dragleave', leave);
        root.removeEventListener('drop', drop, true);
        root.removeEventListener('paste', paste, true);
      };
    });
    return () => {
      detach();
      remove();
    };
  }, [editor]);
  return null;
}
