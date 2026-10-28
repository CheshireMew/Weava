import { useState, useEffect, useRef } from 'react';
import { useSelectors, type SelectedMedia } from './Selectors.tsx';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
  ListNode,
  ListItemNode,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from '@lexical/list';
import { LinkNode, AutoLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { CodeNode, CodeHighlightNode, $createCodeNode } from '@lexical/code';
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  INSERT_TABLE_COMMAND,
  $createTableNodeWithDimensions,
  $insertTableRowAtSelection,
  $insertTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $deleteTableColumnAtSelection,
  $isTableSelection,
} from '@lexical/table';
import {
  TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $getSelection,
  $getNodeByKey,
  $setSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  DecoratorNode,
  type NodeKey,
  type LexicalEditor,
} from 'lexical';
import type { Document } from '@weava/contracts';
import {
  Bold,
  Italic,
  Heading2,
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
class MediaNode extends DecoratorNode<any> {
  __src: string;
  __alt: string;
  __kind: string;
  __caption: string;
  static getType() {
    return 'image';
  }
  static importDOM(): any {
    return {
      img: (el: HTMLImageElement) => ({
        conversion: () => ({ node: new MediaNode(el.getAttribute('src') ?? el.src, el.alt, 'image', undefined, el.closest('figure')?.querySelector('figcaption')?.textContent ?? '') }),
        priority: 1,
      }),
      video: (el: HTMLVideoElement) => ({
        conversion: () => ({ node: new MediaNode(el.getAttribute('src') ?? el.src, '', 'video', undefined, el.closest('figure')?.querySelector('figcaption')?.textContent ?? '') }),
        priority: 1,
      }),
      audio: (el: HTMLAudioElement) => ({ conversion: () => ({ node: new MediaNode(el.getAttribute('src') ?? el.src, '', 'audio') }), priority: 1 }),
    };
  }
  static clone(n: MediaNode) {
    return new MediaNode(n.__src, n.__alt, n.__kind, n.__key, n.__caption);
  }
  constructor(src = '', alt = '', kind = 'image', key?: NodeKey, caption = '') {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__kind = kind;
    this.__caption = caption;
  }
  createDOM() {
    return document.createElement('div');
  }
  isInline() { return false; }
  updateDOM() {
    return false;
  }
  static importJSON(v: any) {
    return new MediaNode(v.src, v.altText, v.kind, undefined, v.caption);
  }
  exportJSON(): any {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      src: this.__src,
      altText: this.__alt,
      kind: this.__kind,
      caption: this.__caption,
    };
  }
  decorate() {
    return <MediaElement nodeKey={this.getKey()} src={this.__src} alt={this.__alt} kind={this.__kind} caption={this.__caption} />;
  }
  exportDOM(): any {
    const figure = document.createElement('figure');
    if (this.__kind === 'file') { const link = document.createElement('a'); link.href = this.__src; link.textContent = this.__alt || '下载附件'; figure.append(link); }
    else { const media = document.createElement(this.__kind === 'audio' ? 'audio' : this.__kind === 'video' ? 'video' : 'img'); media.setAttribute('src', this.__src);
      if (this.__kind === 'image') media.setAttribute('alt', this.__alt); else media.setAttribute('controls', ''); figure.append(media); }
    if (this.__caption) { const caption = document.createElement('figcaption'); caption.textContent = this.__caption; figure.append(caption); }
    return { element: figure };
  }
}
function MediaElement({ nodeKey, src, alt, kind, caption }: { nodeKey: string; src: string; alt: string; kind: string; caption: string }) {
  const [editor] = useLexicalComposerContext(), selectors = useSelectors();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState({ src, alt, caption, kind });
  return <figure className="editor-media" contentEditable={false}>
    {kind === 'video' ? <video src={src} controls /> : kind === 'audio' ? <audio src={src} controls /> : kind === 'file' ? <a href={src}>{alt || '下载附件'}</a> : <img src={src} alt={alt} />}
    {caption && <figcaption>{caption}</figcaption>}<button type="button" onClick={() => { setDraft({ src, alt, caption, kind }); setEditing(!editing); }}>编辑媒体</button>
    {editing && <div className="media-inline-settings"><label>地址<input value={draft.src} onChange={(event) => setDraft({ ...draft, src: event.target.value })} /></label><label>图片说明或附件文字<input value={draft.alt} onChange={(event) => setDraft({ ...draft, alt: event.target.value })} /></label><label>图注<input value={draft.caption} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} /></label>
      <button type="button" onClick={async () => { const media = await selectors.media(); if (media) setDraft({ src: media.url, alt: media.alt ?? media.name, caption: media.caption ?? '', kind: media.kind }); }}>更换媒体</button>
      <button type="button" onClick={() => { editor.update(() => { const node = $getNodeByKey(nodeKey); if (node instanceof MediaNode) { const writable = node.getWritable(); writable.__src = draft.src; writable.__alt = draft.alt; writable.__caption = draft.caption; writable.__kind = draft.kind; } }); setEditing(false); }}>保存媒体修改</button>
      <button type="button" onClick={() => editor.update(() => $getNodeByKey(nodeKey)?.remove())}>移除媒体</button>
    </div>}
  </figure>;
}
function TableTools() {
  const [editor] = useLexicalComposerContext(), [inside, setInside] = useState(false);
  useEffect(() => editor.registerUpdateListener(({ editorState }) => editorState.read(() => {
    const selection = $getSelection();
    let node = $isRangeSelection(selection) || $isTableSelection(selection) ? selection.anchor.getNode() : null;
    while (node && !(node instanceof TableCellNode)) node = node.getParent();
    setInside(!!node);
  })), [editor]);
  return inside ? <div className="table-tools">{[['上方加行', () => $insertTableRowAtSelection(false)], ['下方加行', () => $insertTableRowAtSelection(true)], ['左侧加列', () => $insertTableColumnAtSelection(false)], ['右侧加列', () => $insertTableColumnAtSelection(true)], ['移除行', $deleteTableRowAtSelection], ['移除列', $deleteTableColumnAtSelection]].map(([label, command]) => <button key={String(label)} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.update(command as () => void)}>{label as string}</button>)}</div> : null;
}
const image: Transformer = {
  type: 'text-match',
  dependencies: [MediaNode],
  regExp: /!\[([^\]]*)\]\(([^)]+)\)$/,
  importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  replace: (node, match) => {
    node.replace(new MediaNode(match[2], match[1]));
  },
  export: (node) =>
    node instanceof MediaNode
      ? node.__kind !== 'image' || node.__caption
        ? (node.exportDOM().element as HTMLElement).outerHTML
        : `![${node.__alt}](${node.__src})`
      : null,
};
const table: Transformer = {
  type: 'multiline-element',
  dependencies: [TableNode, TableRowNode, TableCellNode],
  regExpStart: /^\|.+\|\s*$/,
  replace: () => false,
  handleImportAfterStartMatch: ({ lines, startLineIndex, rootNode }) => {
    if (!/^\|[\s:|-]+\|\s*$/.test(lines[startLineIndex + 1] ?? '')) return null;
    let end = startLineIndex + 2;
    while (/^\|.+\|\s*$/.test(lines[end] ?? '')) end++;
    const rows = [lines[startLineIndex], ...lines.slice(startLineIndex + 2, end)].map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, '|')),
    );
    const t = $createTableNodeWithDimensions(
      rows.length,
      Math.max(...rows.map((r) => r.length)),
      true,
    );
    t.getChildren().forEach((r: any, i: number) =>
      r.getChildren().forEach((cell: any, j: number) => {
        cell.clear();
        const p = $createParagraphNode();
        $convertFromMarkdownString(rows[i][j] ?? '', TRANSFORMERS, p);
        cell.append(
          ...p
            .getChildren()
            .map((n: any) => (n.getType() === 'paragraph' ? n : $createParagraphNode().append(n))),
        );
        if (!cell.getChildrenSize()) cell.append($createParagraphNode());
      }),
    );
    rootNode.append(t);
    return [true, end - 1];
  },
  export: (node, traverse) => {
    if (!(node instanceof TableNode)) return null;
    const rows = node
      .getChildren()
      .map((r: any) =>
        r.getChildren().map((c: any) => traverse(c).replace(/\n/g, ' ').replace(/\|/g, '\\|')),
      );
    return rows
      .map(
        (r: string[], i: number) =>
          '| ' +
          r.join(' | ') +
          ' |' +
          (i === 0 ? '\n| ' + r.map(() => '---').join(' | ') + ' |' : ''),
      )
      .join('\n');
  },
};
const transformers = [table, image, ...TRANSFORMERS];
function Toolbar({
  onMode,
  onMedia,
}: {
  onMode: (markdown: string) => void;
  onMedia: () => Promise<SelectedMedia | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const selectors = useSelectors();
  const linkSelection = useRef<ReturnType<typeof $getSelection>>(null);
  const captureLink = (mode: 'link' | 'video') => { linkSelection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null); setLink(link ? null : mode); };
  const [link, setLink] = useState<'link' | 'video' | null>(null),
    [url, setUrl] = useState('');
  function block(kind: string) {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const seen = new Set<string>();
      for (const node of selection.getNodes()) {
        const top = node.getTopLevelElement();
        if (top && 'getChildren' in top && !seen.has(top.getKey())) {
          seen.add(top.getKey());
          const replacement =
            kind === 'h2'
              ? $createHeadingNode('h2')
              : kind === 'quote'
                ? $createQuoteNode()
                : $createCodeNode();
          replacement.append(...top.getChildren());
          top.replace(replacement);
        }
      }
    });
  }
  const button = (title: string, icon: any, run: () => void) => (
    <button type="button" title={title} aria-label={title} onMouseDown={(event) => event.preventDefault()} onClick={run}>
      {icon}
    </button>
  );
  return (
    <>
      <div className="format-toolbar">
        {button('加粗', <Bold size={16} />, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
        )}
        {button('斜体', <Italic size={16} />, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
        )}
        {button('标题', <Heading2 size={17} />, () => block('h2'))}
        {button('引用', <Quote size={16} />, () => block('quote'))}
        {button('无序列表', <List size={17} />, () =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        )}
        {button('有序列表', <ListOrdered size={17} />, () =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
        )}
        {button('代码', <Code size={17} />, () => block('code'))}
        {button('链接', <Link size={16} />, () => captureLink('link'))}
        {button('插入视频', <Video size={17} />, () => captureLink('video'))}
        {button('表格', <Table size={16} />, () =>
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
              $insertNodes([new MediaNode(media.url, media.alt ?? media.name, media.kind, undefined, media.caption)]);
            });
        })}
        <span className="toolbar-spacer" />
        {button('撤销', <Undo2 size={16} />, () => editor.dispatchCommand(UNDO_COMMAND, undefined))}
        {button('重做', <Redo2 size={16} />, () => editor.dispatchCommand(REDO_COMMAND, undefined))}
        <button
          className="text-button"
          onClick={() =>
            editor.getEditorState().read(() => onMode($convertToMarkdownString(transformers)))
          }
        >
          Markdown
        </button>
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
          {link === 'link' && <button type="button" onClick={async () => {
            const selection = linkSelection.current;
            const content = await selectors.content();
            if (content) editor.update(() => { if (selection) $setSelection(selection); editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'entry:' + encodeURIComponent(content.id)); });
            setLink(null);
          }}>链接到内容</button>}
        </div>
      )}
    </>
  );
}
export function Editor({
  value,
  onChange,
  onMedia,
  onError,
}: {
  value: Document;
  onChange: (value: Document) => void;
  onMedia: () => Promise<SelectedMedia | null>;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState(value.format === 'lexical' ? 'visual' : 'source');
  const [seed, setSeed] = useState<Document>(value);
  if (mode === 'source')
    return (
      <div className="document-editor">
        <div className="source-toolbar">
          <span>{value.format === 'html' ? '保留的来源 HTML' : 'Markdown'}</span>
          <button
            onClick={() => {
              if (
                value.format === 'html' ||
                (value.format === 'markdown' && /(<\/?[a-z]|^::|\$\$|^\[\^)/m.test(value.source))
              ) {
                onError('包含不能无损转换的来源格式，继续使用源码模式可完整保留内容。');
                return;
              }
              setSeed(value);
              setMode('visual');
            }}
          >
            可视化编辑
          </button>
        </div>
        <textarea
          className="markdown-editor"
          aria-label="正文源码"
          value={String(value.source)}
          spellCheck={false}
          onChange={(e) => onChange({ ...value, source: e.target.value } as Document)}
        />
      </div>
    );
  return (
    <div className="document-editor">
      <LexicalComposer
        initialConfig={{
          namespace: 'Weava',
          nodes: [
            HeadingNode,
            QuoteNode,
            ListNode,
            ListItemNode,
            LinkNode,
            AutoLinkNode,
            CodeNode,
            CodeHighlightNode,
            TableNode,
            TableRowNode,
            TableCellNode,
            MediaNode,
          ],
          onError: (error) => onError(error.message),
          editorState:
            seed.format === 'lexical'
              ? JSON.stringify(seed.source)
              : () => {
                  $convertFromMarkdownString(String(seed.source), transformers);
                  if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode());
                },
          theme: {
            paragraph: 'editor-paragraph',
            heading: { h1: 'editor-h1', h2: 'editor-h2', h3: 'editor-h3' },
            quote: 'editor-quote',
            list: { ul: 'editor-ul', ol: 'editor-ol' },
            text: { bold: 'editor-bold', italic: 'editor-italic', code: 'editor-code' },
            code: 'editor-codeblock',
            table: 'editor-table',
            tableCell: 'editor-cell',
          },
        }}
      >
        <Toolbar
          onMode={(source) => {
            onChange({ version: 1, format: 'markdown', source });
            setMode('source');
          }}
          onMedia={onMedia}
        />
        <RichTextPlugin
          contentEditable={<ContentEditable className="visual-editor" aria-label="正文编辑器" />}
          placeholder={<span className="editor-placeholder">写下你的内容…</span>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <TablePlugin hasCellMerge={false} />
        <TableTools />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state) =>
            onChange({ version: 1, format: 'lexical', source: state.toJSON() as any })
          }
        />
      </LexicalComposer>
    </div>
  );
}
