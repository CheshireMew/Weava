import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSelectors, type SelectedMedia } from '../Selectors.tsx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
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
import {
  Bold,
  Italic,
  Quote,
  List,
  ListOrdered,
  Code,
  ImagePlus,
  Link,
  Table,
  Undo2,
  Redo2,
  Video,
} from 'lucide-react';
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

export function ToolbarOutlet({
  target,
  children,
}: {
  target?: HTMLElement | null;
  children: ReactNode;
}) {
  return target ? createPortal(children, target) : children;
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
  const selectors = useSelectors();
  const [codeLanguage, setCodeLanguage] = useState('text');
  const [blockType, setBlockType] = useState('paragraph');
  const blockSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const codeSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const linkSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const captureLink = (mode: 'link' | 'video') => {
    linkSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);
    setLink(link ? null : mode);
  };
  const [link, setLink] = useState<'link' | 'video' | null>(null),
    [url, setUrl] = useState('');
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
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
  const button = (title: string, icon: any, run: () => void) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  return (
    <ToolbarOutlet target={target}>
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label="正文格式"
        onClickCapture={onEdit}
        onChangeCapture={onEdit}
        onKeyDownCapture={onEdit}
      >
        {button('撤销', <Undo2 size={16} />, () => editor.dispatchCommand(UNDO_COMMAND, undefined))}
        {button('重做', <Redo2 size={16} />, () => editor.dispatchCommand(REDO_COMMAND, undefined))}
        <span className="toolbar-divider" aria-hidden="true" />
        {!compact && (
          <select
            aria-label="段落格式"
            value={blockType}
            onMouseDown={() => {
              blockSelection.current = editor
                .getEditorState()
                .read(() => $getSelection()?.clone() ?? null);
            }}
            onChange={(event) => block(event.target.value)}
          >
            <option value="paragraph">正文</option>
            <option value="h2">标题</option>
            <option value="quote">引用</option>
            <option value="code">代码</option>
          </select>
        )}
        <span className="toolbar-divider" aria-hidden="true" />
        {button('加粗', <Bold size={16} />, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
        )}
        {button('斜体', <Italic size={16} />, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
        )}
        <span className="toolbar-divider" aria-hidden="true" />
        {!compact && button('引用', <Quote size={16} />, () => block('quote'))}
        {button('无序列表', <List size={17} />, () =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        )}
        {!compact &&
          button('有序列表', <ListOrdered size={17} />, () =>
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
          )}
        {!compact && button('代码', <Code size={17} />, () => block('code'))}
        {blockType === 'code' && (
          <select
            aria-label="代码语言"
            value={codeLanguage}
            onMouseDown={() => {
              codeSelection.current = editor
                .getEditorState()
                .read(() => $getSelection()?.clone() ?? null);
            }}
            onChange={(event) => {
              const language = event.target.value;
              setCodeLanguage(language);
              editor.update(() => {
                if (codeSelection.current) $setSelection(codeSelection.current);
                const selection = $getSelection();
                if ($isRangeSelection(selection))
                  for (const node of selection.getNodes()) {
                    const top = node.getTopLevelElement();
                    if ($isCodeNode(top)) top.setLanguage(language);
                  }
              });
            }}
          >
            {[
              'text',
              'typescript',
              'javascript',
              'python',
              'json',
              'html',
              'css',
              'bash',
              'sql',
              'yaml',
            ].map((language) => (
              <option key={language}>{language}</option>
            ))}
          </select>
        )}
        {button('链接', <Link size={16} />, () => captureLink('link'))}
        {!compact && button('插入视频', <Video size={17} />, () => captureLink('video'))}
        {!compact &&
          button('表格', <Table size={16} />, () =>
            editor.dispatchCommand(INSERT_TABLE_COMMAND, {
              rows: '3',
              columns: '3',
              includeHeaders: true,
            }),
          )}
        {button('插入媒体', <ImagePlus size={17} />, async () => {
          const selection = editor.getEditorState().read(() => $getSelection()?.clone());
          const media = await onMedia();
          if (media)
            editor.update(() => {
              if (selection) $setSelection(selection);
              $insertNodes([
                new MediaNode(
                  media.url,
                  media.alt ?? media.name,
                  media.kind,
                  undefined,
                  media.caption,
                ),
              ]);
            });
        })}
        <span className="toolbar-divider" aria-hidden="true" />
        {!compact && (
          <button
            className="text-button"
            disabled={uploading}
            onClick={() =>
              editor.getEditorState().read(() => onMode($convertToMarkdownString(transformers)))
            }
          >
            Markdown
          </button>
        )}
      </div>
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
                if (link === 'video') {
                  $insertNodes([new MediaNode(url, '', 'video')]);
                } else editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
              });
              setLink(null);
            }}
          >
            {link === 'video' ? '插入视频' : '插入链接'}
          </button>
          {link === 'link' && (
            <button
              type="button"
              onClick={async () => {
                const selection = linkSelection.current;
                const content = await selectors.content();
                if (content)
                  editor.update(() => {
                    if (selection) $setSelection(selection);
                    editor.dispatchCommand(
                      TOGGLE_LINK_COMMAND,
                      'entry:' + encodeURIComponent(content.id),
                    );
                  });
                setLink(null);
              }}
            >
              链接到内容
            </button>
          )}
        </div>
      )}
    </ToolbarOutlet>
  );
}
