import {useState,useRef} from 'react';
import {type SelectedMedia} from './Selectors.tsx';
import {hasDroppedFiles,UploadStatus,useFileUploads} from './file-drop.tsx';
import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {AutoFocusPlugin} from '@lexical/react/LexicalAutoFocusPlugin';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {ListPlugin} from '@lexical/react/LexicalListPlugin';
import {CheckListPlugin} from '@lexical/react/LexicalCheckListPlugin';
import {LinkPlugin} from '@lexical/react/LexicalLinkPlugin';
import {TablePlugin} from '@lexical/react/LexicalTablePlugin';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {HtmlPageText} from './ImportedContentEditor.tsx';
import {HeadingNode,QuoteNode} from '@lexical/rich-text';
import {ListNode,ListItemNode} from '@lexical/list';
import {LinkNode,AutoLinkNode} from '@lexical/link';
import {CodeNode,CodeHighlightNode} from '@lexical/code';
import {TableNode,TableRowNode,TableCellNode} from '@lexical/table';
import {$createParagraphNode,$getRoot} from 'lexical';
import type {Document} from '@weava/contracts';
import {Toolbar,TableTools} from './editor/Toolbar.tsx';
import {MediaNode,EmbedNode} from './editor/nodes.tsx';
import {FileDropPlugin} from './editor/FileDropPlugin.tsx';
import {CodeCopyPlugin} from './editor/CodeCopyPlugin.tsx';
import {LinkEditorPlugin} from './editor/LinkEditorPlugin.tsx';
import {DocumentChangePlugin} from './editor/DocumentChangePlugin.tsx';
import {MarkdownEditor} from './editor/MarkdownEditor.tsx';
import {supportsVisualEditing, importMarkdown} from './editor/markdown.ts';
import {ButtonLinkNode, DetailsNode, FootnoteNode, WritingNodesPlugin} from './editor/WritingNodes.tsx';
import {writingDOMImport} from './editor/writing-dom.ts';

export function Editor({
  value,
  onChange,
  onMedia,
  onError,
  toolbarTarget,
  outputFormat = 'markdown',
  placeholder = '写下你的内容…',
  compact = false,
  snippets = true,
}: {
  value: Document;
  onChange: (value: Document) => void;
  onMedia: () => Promise<SelectedMedia | null>;
  onError: (message: string) => void;
  toolbarTarget?: HTMLElement | null;
  outputFormat?: 'lexical' | 'markdown';
  placeholder?: string;
  compact?: boolean;
  snippets?: boolean;
}) {
  const [mode, setMode] = useState(() => supportsVisualEditing(value) ? 'visual' : 'source');
  const uploads = useFileUploads();
  const editing = useRef(false);
  const markEditing = () => { editing.current = true; };
  const current = useRef({ value, onChange }); current.current = { value, onChange };
  const [sourceView, setSourceView] = useState(value.format === 'markdown' ? String(value.source) : '');
  const sourceText = useRef(sourceView);
  const sourceBaseline = useRef({source: sourceView, document: value});
  const sourceDrops = useRef<{ offset: number }[]>([]);
  function changeSource(source: string) {
    const before = sourceText.current;
    let start = 0, end = 0;
    while (start < before.length && start < source.length && before[start] === source[start]) start++;
    while (end < before.length - start && end < source.length - start && before[before.length - end - 1] === source[source.length - end - 1]) end++;
    for (const position of sourceDrops.current) if (position.offset > start)
      position.offset = position.offset >= before.length - end ? position.offset + source.length - before.length : source.length - end;
    sourceText.current = source; setSourceView(source);
    const document: Document = source === sourceBaseline.current.source ? sourceBaseline.current.document : {version: 1, format: 'markdown', source};
    const unchanged = JSON.stringify(document) === JSON.stringify(current.current.value);
    current.current = { ...current.current, value: document };
    if (!unchanged) current.current.onChange(document);
  }
  const [seed, setSeed] = useState<Document>(value);
  if (value.format === 'html') return <HtmlPageText value={value.source} cleanFormatting label="正文" onChange={source => onChange({ version: 1, format: 'html', source })} />;
  if (mode === 'source') return <div className="document-editor">
    <MarkdownEditor source={sourceView} onChange={changeSource} target={toolbarTarget} compact={compact} snippets={snippets} uploading={uploads.busy || uploads.failed.length > 0} onError={onError} onMedia={onMedia}
      onMode={() => {
        const document: Document = sourceText.current === sourceBaseline.current.source ? sourceBaseline.current.document : {version: 1, format: 'markdown', source: sourceText.current};
        if (!supportsVisualEditing(document)) {onError('包含不能无损转换的来源格式，继续使用源码模式可完整保留内容。'); return;}
        editing.current = false; setSeed(document); setMode('visual');
      }}
      onDrop={event => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        const position = {offset: event.currentTarget.selectionStart}; sourceDrops.current.push(position);
        uploads.upload(Array.from(event.dataTransfer.files), (row, file) => {
          const source = sourceText.current, offset = Math.min(source.length, position.offset);
          const image = document.createElement('img'); image.src = row.value.url; image.alt = row.value.alt ?? file.name;
          const text = '![' + image.alt.replace(/[\\[\]]/g, '\\$&') + '](' + row.value.url + ')';
          changeSource(source.slice(0, offset) + '\n\n' + text + '\n\n' + source.slice(offset)); position.offset = offset + text.length + 4;
        });
      }}/>
    <UploadStatus uploads={uploads}/>
  </div>;
  return (
    <div className="document-editor" onBeforeInputCapture={markEditing} onInputCapture={markEditing} onPasteCapture={markEditing} onCutCapture={markEditing} onDropCapture={markEditing}
      onKeyDownCapture={event => {if ((event.target as Element).closest('.visual-editor') && (['Backspace','Delete','Enter'].includes(event.key) || event.key === ' ' && (event.target as Element).closest('[role="checkbox"]') || (event.ctrlKey || event.metaKey) && ['b','i','u','z','y'].includes(event.key.toLowerCase()))) markEditing();}}
      onClickCapture={event => { if ((event.target as Element).closest('button:not(.editor-mode-toggle):not([aria-haspopup])')) markEditing(); }}>
      <LexicalComposer
        initialConfig={{
          namespace: 'Weava',
          html: {import: writingDOMImport},
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
            HorizontalRuleNode,
            EmbedNode,
            ButtonLinkNode, DetailsNode, FootnoteNode,
          ],
          onError: (error) => onError(error.message),
          editorState:
            seed.format === 'lexical'
              ? JSON.stringify(seed.source)
              : (editor) => {
                  importMarkdown(editor, String(seed.source));
                  if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode());
                },
          theme: {
            paragraph: 'editor-paragraph',
            heading: { h1: 'editor-h1', h2: 'editor-h2', h3: 'editor-h3', h4: 'editor-h4', h5: 'editor-h5', h6: 'editor-h6' },
            quote: 'editor-quote',
            list: { ul: 'editor-ul', ol: 'editor-ol', nested: { listitem: 'editor-nested-listitem' }, listitemChecked: 'editor-task-checked', listitemUnchecked: 'editor-task-unchecked' },
            text: { bold: 'editor-bold', italic: 'editor-italic', code: 'editor-code', strikethrough: 'editor-strikethrough', underline: 'editor-underline', highlight: 'editor-highlight' },
            code: 'editor-codeblock',
            table: 'editor-table',
            tableScrollableWrapper: 'editor-table-scroll',
            tableCell: 'editor-cell',
          },
        }}
      >
        <Toolbar
          onEdit={markEditing}
          target={toolbarTarget}
          compact={compact}
          snippets={snippets}
          uploading={uploads.busy || uploads.failed.length > 0}
          onMode={(source) => {
            const document = current.current.value;
            const markdown = document.format === 'markdown' ? String(document.source) : source;
            sourceText.current = markdown; sourceBaseline.current = {source: markdown, document}; setSourceView(markdown);
            editing.current = false;
            setMode('source');
          }}
          onMedia={onMedia}
        />
        <WritingNodesPlugin/>
        <div className="editor-canvas">
          <RichTextPlugin
            contentEditable={<ContentEditable className="visual-editor" aria-label="正文编辑器" />}
            placeholder={<span className="editor-placeholder">{placeholder}</span>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <CodeCopyPlugin onError={onError}/>
        <FileDropPlugin uploads={uploads}/>
        {compact&&<AutoFocusPlugin defaultSelection="rootStart"/>}
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <LinkEditorPlugin onEdit={markEditing} onError={onError}/>
        <TablePlugin hasCellMerge={false} hasHorizontalScroll />
        <TableTools />
        <DocumentChangePlugin value={value} editing={editing} outputFormat={outputFormat} onChange={onChange}/>
      </LexicalComposer>
      <UploadStatus uploads={uploads}/>
    </div>
  );
}
