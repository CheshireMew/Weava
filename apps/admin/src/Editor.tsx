import {useState,useRef} from 'react';
import {type SelectedMedia} from './Selectors.tsx';
import {clipboardImages,hasDroppedFiles,UploadStatus,useFileUploads} from './file-drop.tsx';
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
import {LargeMarkdownPlugin} from './editor/LargeMarkdownPlugin.tsx';
import {LinkEditorPlugin} from './editor/LinkEditorPlugin.tsx';
import {DocumentChangePlugin} from './editor/DocumentChangePlugin.tsx';
import {DocumentStartPlugin} from './editor/DocumentStartPlugin.tsx';
import {DividerSelectionPlugin} from './editor/DividerSelectionPlugin.tsx';
import {MarkdownEditor} from './editor/MarkdownEditor.tsx';
import {supportsVisualEditing, importMarkdown} from './editor/markdown.ts';
import {ButtonLinkNode, DetailsNode, FootnoteNode, WritingNodesPlugin} from './editor/WritingNodes.tsx';
import {writingDOMImport} from './editor/writing-dom.ts';
const documentNodes=[HeadingNode,QuoteNode,ListNode,ListItemNode,LinkNode,AutoLinkNode,CodeNode,CodeHighlightNode,
  TableNode,TableRowNode,TableCellNode,MediaNode,HorizontalRuleNode,EmbedNode,ButtonLinkNode,DetailsNode,FootnoteNode];

export function Editor({
  value,
  onChange,
  onMedia,
  onError,
  toolbarTarget,
  entryId,
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
  entryId?: string;
  outputFormat?: 'lexical' | 'markdown';
  placeholder?: string;
  compact?: boolean;
  snippets?: boolean;
}) {
  const [mode, setMode] = useState(() => supportsVisualEditing(value) ? 'visual' : 'source');
  const uploads = useFileUploads();
  const editing = useRef(false);
  const [loading,loadingProgress]=useState<number|null>(null),loadingError=useRef(onError);loadingError.current=onError;
  const flushSnapshot=useRef(()=>{});
  const markEditing = () => { editing.current = true; };
  const current = useRef({ value, onChange }); current.current = { value, onChange };
  const [sourceView, setSourceView] = useState(value.format === 'markdown' ? String(value.source) : '');
  const sourceText = useRef(sourceView);
  const sourceBaseline = useRef({source: sourceView, document: value});
  const sourceDrops = useRef<{ offset: number }[]>([]);
  function changeSource(source: string) {
    const before = sourceText.current;
    if(sourceDrops.current.length){
      let start = 0, end = 0;
      while (start < before.length && start < source.length && before[start] === source[start]) start++;
      while (end < before.length - start && end < source.length - start && before[before.length - end - 1] === source[source.length - end - 1]) end++;
      for (const position of sourceDrops.current) if (position.offset > start)
        position.offset = position.offset >= before.length - end ? position.offset + source.length - before.length : source.length - end;
    }
    sourceText.current = source; setSourceView(source);
    const document: Document = source === sourceBaseline.current.source ? sourceBaseline.current.document : {version: 1, format: 'markdown', source};
    const unchanged = document===current.current.value||document.format===current.current.value.format&&document.source===current.current.value.source;
    current.current = { ...current.current, value: document };
    if (!unchanged) current.current.onChange(document);
  }
  function uploadSource(files: File[], offset: number) {
    const position = {offset}; sourceDrops.current.push(position);
    let remaining = files.length;
    uploads.upload(files, (row, file) => {
      const source = sourceText.current, offset = Math.min(source.length, position.offset);
      const alt = row.value.alt ?? file.name;
      const text = '![' + alt.replace(/[\\[\]]/g, '\\$&') + '](' + row.value.url + ')';
      changeSource(source.slice(0, offset) + '\n\n' + text + '\n\n' + source.slice(offset)); position.offset = offset + text.length + 4;
      if (!--remaining) sourceDrops.current = sourceDrops.current.filter(anchor => anchor !== position);
    });
  }
  const [seed, setSeed] = useState<Document>(value);
  const visitedVisual=useRef(mode==='visual');if(mode==='visual')visitedVisual.current=true;
  const retainVisual=visitedVisual.current&&seed.format==='markdown'&&String(seed.source).length>40000;
  if (value.format === 'html') return <HtmlPageText value={value.source} cleanFormatting label="正文" onChange={source => onChange({ version: 1, format: 'html', source })} />;
  const sourceEditor=mode === 'source'?<div className="document-editor">
    <MarkdownEditor source={sourceView} onChange={changeSource} target={toolbarTarget} compact={compact} snippets={snippets} uploading={uploads.busy || uploads.failed.length > 0} onError={onError} onMedia={onMedia} entryId={entryId}
      onMode={() => {
        const document: Document = sourceText.current === sourceBaseline.current.source ? sourceBaseline.current.document : {version: 1, format: 'markdown', source: sourceText.current};
        if (!supportsVisualEditing(document)) {onError('包含不能无损转换的来源格式，继续使用源码模式可完整保留内容。'); return;}
        editing.current = false;if(!retainVisual||sourceText.current!==sourceBaseline.current.source)setSeed(document);setMode('visual');
      }}
      onDrop={(event,offset) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        uploadSource(Array.from(event.dataTransfer.files), offset);
      }}
      onPaste={(event,offset) => {
        const files = clipboardImages(event.clipboardData);
        if (!files.length) return;
        event.preventDefault(); event.stopPropagation();
        uploadSource(files, offset);
      }}/>
    <UploadStatus uploads={uploads}/>
  </div>:null;
  if(mode==='source'&&!retainVisual)return sourceEditor;
  return (<>{sourceEditor}
    <div className="document-editor" style={mode==='source'?{display:'none'}:undefined} onBeforeInputCapture={markEditing} onInputCapture={markEditing} onPasteCapture={markEditing} onCutCapture={markEditing} onDropCapture={markEditing}
      onKeyDownCapture={event => {if ((event.target as Element).closest('.visual-editor') && (['Backspace','Delete','Enter'].includes(event.key) || event.key === ' ' && (event.target as Element).closest('[role="checkbox"]') || (event.ctrlKey || event.metaKey) && ['b','i','u','z','y'].includes(event.key.toLowerCase()))) markEditing();}}
      onClickCapture={event => { if ((event.target as Element).closest('button:not(.editor-mode-toggle):not([aria-haspopup])')) markEditing(); }}>
      <LexicalComposer
        initialConfig={{
          namespace: 'Weava',
          html: {import: writingDOMImport},
          nodes: documentNodes,
          onError: (error) => onError(error.message),
          editorState:
            seed.format === 'lexical'
              ? JSON.stringify(seed.source)
              : (editor) => {
                  if(String(seed.source).length<=40000)importMarkdown(editor, String(seed.source));
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
            hr: 'editor-divider',
            hrSelected: 'editor-divider-selected',
          },
        }}
      >
        {mode==='visual'&&<Toolbar
          disabled={loading!==null}
          onEdit={markEditing}
          target={toolbarTarget}
          compact={compact}
          snippets={snippets}
          uploading={uploads.busy || uploads.failed.length > 0}
          onMode={(source) => {
            flushSnapshot.current();
            const document = current.current.value;
            const markdown = document.format === 'markdown' ? String(document.source) : source();
            sourceText.current = markdown; sourceBaseline.current = {source: markdown, document}; setSourceView(markdown);
            editing.current = false;
            setMode('source');
          }}
          onMedia={onMedia}
        />}
        <WritingNodesPlugin/>
        <DocumentStartPlugin/>
        <DividerSelectionPlugin/>
        {loading!==null&&<p role="status">正在载入正文… {loading}%</p>}
        <div className="editor-canvas" aria-busy={loading!==null}>
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
        <LinkEditorPlugin onEdit={markEditing} onError={onError} entryId={entryId}/>
        <TablePlugin hasCellMerge={false} hasHorizontalScroll />
        <TableTools />
        <DocumentChangePlugin value={value} seed={seed} editing={editing} outputFormat={outputFormat} onChange={document=>{current.current.value=document;current.current.onChange(document);}} flushSnapshot={flushSnapshot}/>
        {seed.format==='markdown'&&String(seed.source).length>40000&&<LargeMarkdownPlugin source={String(seed.source)} nodes={documentNodes} progress={loadingProgress} onError={loadingError}/>}
      </LexicalComposer>
      <UploadStatus uploads={uploads}/>
    </div></>
  );
}
