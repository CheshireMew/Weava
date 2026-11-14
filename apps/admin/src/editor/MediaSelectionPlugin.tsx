import {useEffect, useRef} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$addUpdateTag, $createNodeSelection, $createParagraphNode, $getNearestNodeFromDOMNode, $getSelection, $isElementNode, $isNodeSelection, $isParagraphNode, $setSelection, $splitNode, CLICK_COMMAND, COMMAND_PRIORITY_HIGH, HISTORY_PUSH_TAG, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND, SKIP_SCROLL_INTO_VIEW_TAG, type LexicalNode} from 'lexical';
import {MediaNode} from './nodes.tsx';

type Side = 'before' | 'after';
export function MediaSelectionPlugin({onEdit}: {onEdit: () => void}) {
  const [editor] = useLexicalComposerContext();
  const editing = useRef(onEdit); editing.current = onEdit;
  useEffect(() => {
    let hinted: HTMLElement | null = null;
    let gapClick = false;
    const clear = () => {hinted?.removeAttribute('data-insert-side'); hinted = null;};
    const figureFor = (target: EventTarget | null) => target instanceof Element && !target.closest('button,input,audio,video') ? target.closest<HTMLElement>('.editor-media') : null;
    const edge = (root: HTMLElement, event: MouseEvent) => {
      const figure = figureFor(event.target);
      for (const element of figure ? [figure] : root.querySelectorAll<HTMLElement>('.editor-media')) {
        const rect = element.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right) continue;
        if (event.clientY >= rect.top - 16 && event.clientY < rect.top) return {element, side: 'before' as const};
        if (event.clientY > rect.bottom && event.clientY <= rect.bottom + 16) return {element, side: 'after' as const};
      }
      return null;
    };
    const beside = (node: MediaNode, side: Side, insert: boolean) => {
      let anchor: LexicalNode = node;
      const parent = node.getParent(), previous = side === 'before';
      // Markdown images can share a paragraph with text. Keep inserted text
      // blocks outside that paragraph instead of nesting paragraphs inside it.
      if ($isParagraphNode(parent)) {
        const offset = node.getIndexWithinParent() + (previous ? 0 : 1);
        if (offset > 0 && offset < parent.getChildrenSize()) {
          if (!insert) {if (previous) node.selectPrevious(); else node.selectNext(); clear(); return;}
          editing.current(); $addUpdateTag(HISTORY_PUSH_TAG);
          const [left, right] = $splitNode(parent, offset); anchor = previous ? right : left!;
        } else anchor = parent;
      }
      const adjacent = previous ? anchor.getPreviousSibling() : anchor.getNextSibling();
      if ($isElementNode(adjacent) && (!insert || $isParagraphNode(adjacent) && adjacent.isEmpty())) {
        if (side === 'before') adjacent.selectEnd(); else adjacent.selectStart();
      } else {
        editing.current(); $addUpdateTag(HISTORY_PUSH_TAG);
        const paragraph = $createParagraphNode();
        if (previous) anchor.insertBefore(paragraph); else anchor.insertAfter(paragraph);
        paragraph.selectStart();
      }
      clear();
    };
    const select = (element: HTMLElement) => {
      const node = $getNearestNodeFromDOMNode(element);
      if (!(node instanceof MediaNode)) return false;
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
      const selection = $createNodeSelection(); selection.add(node.getKey()); $setSelection(selection);
      return true;
    };
    const down = (event: MouseEvent) => {
      gapClick = false;
      const root = editor.getRootElement(); if (!root || event.button !== 0) return;
      const gap = edge(root, event), figure = figureFor(event.target);
      if (!gap && !figure) return;
      event.preventDefault(); root.focus({preventScroll: true});
      gapClick = !!gap;
      editor.update(() => {
        if (gap) {
          const node = $getNearestNodeFromDOMNode(gap.element);
          if (node instanceof MediaNode) beside(node, gap.side, true);
        } else select(figure!);
      }, {discrete: true});
    };
    const move = (event: MouseEvent) => {
      const root = editor.getRootElement(), gap = root && edge(root, event);
      clear();
      if (gap) {hinted = gap.element; hinted.dataset.insertSide = gap.side;}
    };
    const removeRoot = editor.registerRootListener((root, previous) => {
      previous?.removeEventListener('mousedown', down, true); previous?.removeEventListener('mousemove', move); previous?.removeEventListener('mouseleave', clear);
      root?.addEventListener('mousedown', down, true); root?.addEventListener('mousemove', move); root?.addEventListener('mouseleave', clear);
    });
    const key = (event: KeyboardEvent | null, side: Side, insert: boolean) => {
      if (event?.ctrlKey || event?.metaKey || event?.altKey || !insert && event?.shiftKey) return false;
      const selection = $getSelection(), nodes = $isNodeSelection(selection) ? selection.getNodes() : [];
      if (nodes.length !== 1 || !(nodes[0] instanceof MediaNode)) return false;
      event?.preventDefault(); beside(nodes[0], side, insert); return true;
    };
    const remove = [
      removeRoot,
      editor.registerCommand(CLICK_COMMAND, event => {
        if (gapClick) {gapClick = false; event.preventDefault(); return true;}
        const figure = figureFor(event.target); return !!figure && select(figure);
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, event => key(event, 'before', false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, event => key(event, 'after', false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, event => key(event, event?.shiftKey ? 'before' : 'after', true), COMMAND_PRIORITY_HIGH),
    ];
    return () => {remove.forEach(stop => stop()); clear();};
  }, [editor]);
  return null;
}
