import { useState, useEffect, useRef } from 'react';
import {FormattingToolbar, ToolbarOutlet, type FormatAction} from './FormattingToolbar.tsx';
import {type SelectedMedia} from '../Selectors.tsx';
import {$parentLink, OPEN_LINK_EDITOR_COMMAND} from './LinkEditorPlugin.tsx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list';
import { $createCodeNode, $isCodeNode } from '@lexical/code';
import {
  TableCellNode,
  INSERT_TABLE_COMMAND,
  $insertTableRowAtSelection,
  $insertTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $deleteTableColumnAtSelection,
  $isTableSelection,
} from '@lexical/table';
import { $convertToMarkdownString } from '@lexical/markdown';
import {
  $getSelection,
  $setSelection,
  $isRangeSelection,
  $createParagraphNode,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
} from 'lexical';

import { MediaNode } from './nodes.tsx';
import { transformers } from './transformers.tsx';

export function TableTools() {
  const [editor] = useLexicalComposerContext(),
    [inside, setInside] = useState(false);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          let node =
            $isRangeSelection(selection) || $isTableSelection(selection)
              ? selection.anchor.getNode()
              : null;
          while (node && !(node instanceof TableCellNode)) node = node.getParent();
          setInside(!!node);
        }),
      ),
    [editor],
  );
  return inside ? (
    <div className="table-tools">
      {[
        ['上方加行', () => $insertTableRowAtSelection(false)],
        ['下方加行', () => $insertTableRowAtSelection(true)],
        ['左侧加列', () => $insertTableColumnAtSelection(false)],
        ['右侧加列', () => $insertTableColumnAtSelection(true)],
        ['移除行', $deleteTableRowAtSelection],
        ['移除列', $deleteTableColumnAtSelection],
      ].map(([label, command]) => (
        <button
          key={String(label)}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.update(command as () => void)}
        >
          {label as string}
        </button>
      ))}
    </div>
  ) : null;
}

export function Toolbar({
  onMode,
  onMedia,
  target,
  compact = false,
  uploading = false,
  onEdit,
}: {
  onMode: (markdown: string) => void;
  onMedia: () => Promise<SelectedMedia | null>;
  target?: HTMLElement | null;
  compact?: boolean;
  uploading?: boolean;
  onEdit: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [linkActive, setLinkActive] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('text');
  const [blockType, setBlockType] = useState('paragraph');
  const blockSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const codeSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const linkSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const captureLink = () => {
    linkSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);
    setLink(link ? null : 'video'); setUrl('');
  };
  const [link, setLink] = useState<'video' | null>(null),
    [url, setUrl] = useState('');
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {setLinkActive(false); return;}
          setLinkActive(!!$parentLink(selection.anchor.getNode()));
          const type = selection.anchor.getNode().getTopLevelElement()?.getType();
          setBlockType(
            type === 'heading' ? 'h2' : type === 'quote' || type === 'code' ? type : 'paragraph',
          );
        }),
      ),
    [editor],
  );
  function block(kind: string) {
    editor.update(() => {
      if (blockSelection.current) {
        $setSelection(blockSelection.current);
        blockSelection.current = null;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const seen = new Set<string>();
      for (const node of selection.getNodes()) {
        const top = node.getTopLevelElement();
        if (top && 'getChildren' in top && !seen.has(top.getKey())) {
          seen.add(top.getKey());
          const replacement =
            kind === 'paragraph'
              ? $createParagraphNode()
              : kind === 'h2'
                ? $createHeadingNode('h2')
                : kind === 'quote'
                  ? $createQuoteNode()
                  : $createCodeNode(codeLanguage);
          replacement.append(...top.getChildren());
          top.replace(replacement);
        }
      }
    });
  }
  function action(command: FormatAction) {
    if (command === 'undo' || command === 'redo') editor.dispatchCommand(command === 'undo' ? UNDO_COMMAND : REDO_COMMAND, undefined);
    else if (command === 'bold' || command === 'italic') editor.dispatchCommand(FORMAT_TEXT_COMMAND, command);
    else if (command === 'quote' || command === 'code') block(command);
    else if (command === 'bullet' || command === 'ordered') editor.dispatchCommand(command === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
    else if (command === 'link') editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined);
    else if (command === 'video') captureLink();
    else if (command === 'table') editor.dispatchCommand(INSERT_TABLE_COMMAND, {rows: '3', columns: '3', includeHeaders: true});
    else if (command === 'media') {
      const selection = editor.getEditorState().read(() => $getSelection()?.clone());
      void onMedia().then(media => { if (media) editor.update(() => {
        if (selection) $setSelection(selection);
        $insertNodes([new MediaNode(media.url, media.alt ?? media.name, media.kind, undefined, media.caption)]);
      }); });
    }
  }
  return (
    <ToolbarOutlet target={target}>
      <FormattingToolbar mode="visual" compact={compact} uploading={uploading} onEdit={onEdit} linkActive={linkActive}
        onMode={() => editor.getEditorState().read(() => onMode($convertToMarkdownString(transformers)))}
        onAction={action} blockType={blockType} onBlock={block}
        onCaptureBlock={() => {blockSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);}}
        codeLanguage={codeLanguage} onCaptureLanguage={() => {codeSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);}}
        onLanguage={language => {setCodeLanguage(language); editor.update(() => {
          if (codeSelection.current) $setSelection(codeSelection.current);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) for (const node of selection.getNodes()) {const top = node.getTopLevelElement(); if ($isCodeNode(top)) top.setLanguage(language);}
        });}}
      />
      {link && (
        <div className="inline-input">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="链接地址"
          />
          <button
            onClick={() => {
              editor.update(() => {
                if (linkSelection.current) $setSelection(linkSelection.current);
                $insertNodes([new MediaNode(url, '', 'video')]);
              });
              setLink(null);
            }}
          >
            插入视频
          </button>

        </div>
      )}
    </ToolbarOutlet>
  );
}
