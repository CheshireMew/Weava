import { useState, useEffect, useRef } from 'react';
import {FormattingToolbar, ToolbarOutlet, type FormatAction} from './FormattingToolbar.tsx';
import {type SelectedMedia} from '../Selectors.tsx';
import {$parentLink, OPEN_LINK_EDITOR_COMMAND} from './LinkEditorPlugin.tsx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, type HeadingTagType } from '@lexical/rich-text';
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
import {$setBlocksType, $patchStyleText} from '@lexical/selection';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $getSelection,
  $setSelection,
  $isRangeSelection,
  $createParagraphNode,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND, $createTextNode, $isElementNode,
  UNDO_COMMAND,
  REDO_COMMAND,
} from 'lexical';

import { MediaNode } from './nodes.tsx';
import {exportMarkdown} from './transformers.tsx';
import {markdownNodes} from './markdown.ts';
import {ButtonLinkNode, DetailsNode, FootnoteNode} from './WritingNodes.tsx';
import {SnippetsDialog, WritingInsertDialog, type WritingInsert} from './WritingDialogs.tsx';
import {textColors, highlightColors} from '../../../../packages/runtime-common/src/writing-format.ts';

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
  snippets = true,
  uploading = false,
  onEdit,
  disabled,
}: {
  onMode: (markdown: () => string) => void;
  onMedia: () => Promise<SelectedMedia | null>;
  target?: HTMLElement | null;
  compact?: boolean;
  snippets?: boolean;
  uploading?: boolean;
  onEdit: () => void;
  disabled?:boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [linkActive, setLinkActive] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('text');
  const [blockType, setBlockType] = useState('paragraph');
  const savedSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const [insert, setInsert] = useState<WritingInsert | 'snippets' | null>(null), [selected, setSelected] = useState('');
  const capture = () => {const selection = editor.getEditorState().read(() => $getSelection()?.clone() ?? null); if (selection) savedSelection.current = selection;};
  const restore = () => {if (savedSelection.current) $setSelection(savedSelection.current.clone());};
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
          savedSelection.current = selection.clone();
          setLinkActive(!!$parentLink(selection.anchor.getNode()));
          let parent = selection.anchor.getNode(); while (parent.getParent() && !['heading','quote','code','paragraph'].includes(parent.getType())) parent = parent.getParent()!;
          const type = parent.getType();
          setBlockType(
            $isHeadingNode(parent) ? parent.getTag() : type === 'quote' || type === 'code' ? type : 'paragraph',
          );
          if ($isCodeNode(parent)) setCodeLanguage(parent.getLanguage() || 'text');
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
      else restore();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => kind === 'paragraph' ? $createParagraphNode() : /^h[1-6]$/.test(kind) ? $createHeadingNode(kind as HeadingTagType) : kind === 'quote' ? $createQuoteNode() : $createCodeNode(codeLanguage));
    });
  }
  function action(command: FormatAction) {
    editor.update(restore, {discrete: true});
    if (command === 'undo' || command === 'redo') editor.dispatchCommand(command === 'undo' ? UNDO_COMMAND : REDO_COMMAND, undefined);
    else if (['bold','italic','strikethrough','underline','superscript','subscript','inline-code'].includes(command)) editor.dispatchCommand(FORMAT_TEXT_COMMAND, (command === 'inline-code' ? 'code' : command) as any);
    else if (command.startsWith('align:')) editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, command.slice(6) as any);
    else if (command.startsWith('color:') || command.startsWith('highlight:')) editor.update(() => {
      const selection = $getSelection(); if (!$isRangeSelection(selection)) return;
      const [kind, value] = command.split(':');
      if (kind === 'color') $patchStyleText(selection, {color: textColors[value as keyof typeof textColors]?.value ?? null});
      else {
        const nodes = selection.isCollapsed() ? [] : selection.extract();
        const highlight = value !== 'none';
        if (selection.isCollapsed() && selection.hasFormat('highlight') !== highlight) selection.toggleFormat('highlight');
        for (const node of nodes) if ('hasFormat' in node && (node as any).hasFormat('highlight') !== highlight) (node as any).toggleFormat('highlight');
        $patchStyleText(selection, {'background-color': highlightColors[value as keyof typeof highlightColors]?.value ?? null});
      }
    });
    else if (command === 'quote' || command === 'code') block(blockType === command ? 'paragraph' : command);
    else if (command === 'bullet' || command === 'ordered') editor.dispatchCommand(command === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
    else if (command === 'link') editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined);
    else if (command === 'video') captureLink();
    else if (command === 'table') editor.dispatchCommand(INSERT_TABLE_COMMAND, {rows: '3', columns: '3', includeHeaders: true});
    else if (command === 'divider') editor.update(() => {$insertNodes([new HorizontalRuleNode(), $createParagraphNode()]);});
    else if (['button','footnote','details','snippets'].includes(command)) {capture(); setSelected(editor.getEditorState().read(() => $getSelection()?.getTextContent() ?? '')); setInsert(command as WritingInsert | 'snippets');}
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
      <FormattingToolbar mode="visual" disabled={disabled} compact={compact} snippets={snippets} uploading={uploading} onEdit={onEdit} linkActive={linkActive} onCapture={capture}
        onMode={() => onMode(()=>editor.getEditorState().read(() => exportMarkdown()))}
        onAction={action} blockType={blockType} onBlock={block}
        onCaptureBlock={() => {blockSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);}}
        codeLanguage={codeLanguage} onCaptureLanguage={() => {codeSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);}}
        onLanguage={language => {setCodeLanguage(language); editor.update(() => {
          if (codeSelection.current) $setSelection(codeSelection.current);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) for (const node of selection.getNodes()) {const top = node.getTopLevelElement(); if ($isCodeNode(top)) top.setLanguage(language);}
        });}}
      />
      {insert === 'snippets' && <SnippetsDialog onClose={() => setInsert(null)} onInsert={source => {onEdit(); editor.update(() => {restore(); $insertNodes(markdownNodes(editor, source));});}}/>}
      {insert && insert !== 'snippets' && <WritingInsertDialog kind={insert} selected={selected} onClose={() => setInsert(null)} onInsert={value => {
        onEdit(); editor.update(() => {
          restore();
          if (insert === 'button') $insertNodes([new ButtonLinkNode(value.url).append($createTextNode(value.title))]);
          else if (insert === 'footnote') $insertNodes([new FootnoteNode('note-' + crypto.randomUUID().slice(0, 8), value.source)]);
          else {
            const selection = $getSelection(), details = new DetailsNode(value.title);
            if ($isRangeSelection(selection) && !selection.isCollapsed()) {
              const blocks = [...new Set(selection.getNodes().map(node => {let block = $isElementNode(node) ? node : node.getParent(); while (block?.getParent() && !['root','writing-details'].includes(block.getParent()!.getType())) block = block.getParent(); return block;}).filter(node => node && !['root','writing-details'].includes(node.getType())))];
              if (blocks.length) {blocks[0]!.insertBefore(details); details.append(...blocks as any);}
              else $insertNodes([details.append($createParagraphNode())]);
            } else $insertNodes([details.append($createParagraphNode())]);
            details.selectStart();
          }
        }); setInsert(null);
      }}/>}
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
