import { useEffect, useRef } from 'react';
import { allowFileDrop, dropRange, hasDroppedFiles, useFileUploads } from '../file-drop.tsx';
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
      const drop = (event: DragEvent) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        leave();
        let insertion: ReturnType<typeof $getSelection> = null;
        const range = dropRange(root.ownerDocument, root, event.clientX, event.clientY);
        editor.update(
          () => {
            const selection = $createRangeSelection();
            selection.applyDOMRange(range);
            insertion = selection;
          },
          { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
        );
        latest.current.upload(Array.from(event.dataTransfer!.files), (row) => {
          if (!editor.getRootElement()) throw new Error('正文已经切换，图片已保存在媒体库中。');
          editor.update(
            () => {
              const previous = $getSelection()?.clone() ?? null;
              if (
                $isRangeSelection(insertion) &&
                $getNodeByKey(insertion.anchor.key) &&
                $getNodeByKey(insertion.focus.key)
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
              if (
                $isRangeSelection(previous) &&
                $getNodeByKey(previous.anchor.key) &&
                $getNodeByKey(previous.focus.key)
              )
                $setSelection(previous);
            },
            { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
          );
        });
      };
      root.addEventListener('dragover', over);
      root.addEventListener('dragleave', leave);
      root.addEventListener('drop', drop, true);
      detach = () => {
        root.removeEventListener('dragover', over);
        root.removeEventListener('dragleave', leave);
        root.removeEventListener('drop', drop, true);
      };
    });
    return () => {
      detach();
      remove();
    };
  }, [editor]);
  return null;
}
