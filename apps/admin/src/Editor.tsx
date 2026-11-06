import {useState,useRef} from 'react';
import {type SelectedMedia} from './Selectors.tsx';
import {allowFileDrop,hasDroppedFiles,UploadStatus,useFileUploads} from './file-drop.tsx';
import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {AutoFocusPlugin} from '@lexical/react/LexicalAutoFocusPlugin';
import {OnChangePlugin} from '@lexical/react/LexicalOnChangePlugin';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {ListPlugin} from '@lexical/react/LexicalListPlugin';
import {LinkPlugin} from '@lexical/react/LexicalLinkPlugin';
import {TablePlugin} from '@lexical/react/LexicalTablePlugin';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {HtmlPageText} from './ImportedContentEditor.tsx';
import {HeadingNode,QuoteNode} from '@lexical/rich-text';
import {ListNode,ListItemNode} from '@lexical/list';
import {LinkNode,AutoLinkNode} from '@lexical/link';
import {CodeNode,CodeHighlightNode} from '@lexical/code';
import {TableNode,TableRowNode,TableCellNode} from '@lexical/table';
import {$convertFromMarkdownString,$convertToMarkdownString} from '@lexical/markdown';
import {$createParagraphNode,$getRoot} from 'lexical';
import type {Document} from '@weava/contracts';
import {ToolbarOutlet,Toolbar,TableTools} from './editor/Toolbar.tsx';
import {MediaNode,EmbedNode} from './editor/nodes.tsx';
import {transformers} from './editor/transformers.tsx';
import {FileDropPlugin} from './editor/FileDropPlugin.tsx';

function supportsVisualEditing(document: Document) {
  return document.format === 'lexical' ||
    (document.format === 'markdown' && !/(<\/?[a-z]|^::|\$\$|^\[\^)/m.test(document.source));
}

export function Editor({
  value,
  onChange,
  onMedia,
  onError,
  toolbarTarget,
  outputFormat = 'lexical',
  placeholder = '写下你的内容…',
  compact = false,
}: {
  value: Document;
  onChange: (value: Document) => void;
  onMedia: () => Promise<SelectedMedia | null>;
  onError: (message: string) => void;
  toolbarTarget?: HTMLElement | null;
  outputFormat?: 'lexical' | 'markdown';
  placeholder?: string;
  compact?: boolean;
}) {
  const [mode, setMode] = useState(() => supportsVisualEditing(value) ? 'visual' : 'source');
  const uploads = useFileUploads();
  const editing = useRef(false);
  const markEditing = () => { editing.current = true; };
  const current = useRef({ value, onChange }); current.current = { value, onChange };
  const sourceDrops = useRef<{ offset: number }[]>([]);
  function changeSource(source: string) {
    const before = String(current.current.value.source);
    let start = 0, end = 0;
    while (start < before.length && start < source.length && before[start] === source[start]) start++;
    while (end < before.length - start && end < source.length - start && before[before.length - end - 1] === source[source.length - end - 1]) end++;
    for (const position of sourceDrops.current) if (position.offset > start)
      position.offset = position.offset >= before.length - end ? position.offset + source.length - before.length : source.length - end;
    const document = { ...current.current.value, source } as Document;
    current.current = { ...current.current, value: document }; current.current.onChange(document);
  }
  const [seed, setSeed] = useState<Document>(value);
  if (value.format === 'html') return <HtmlPageText value={value.source} cleanFormatting label="正文" onChange={source => onChange({ version: 1, format: 'html', source })} />;
  if (mode === 'source')
    return (
      <div className="document-editor">
        <ToolbarOutlet target={toolbarTarget}><div className="source-toolbar">
          <span>Markdown</span>
          <button
            disabled={uploads.busy || uploads.failed.length > 0}
            onClick={() => {
              if (!supportsVisualEditing(value)) {
                onError('包含不能无损转换的来源格式，继续使用源码模式可完整保留内容。');
                return;
              }
              setSeed(value);
              setMode('visual');
            }}
          >
            可视化编辑
          </button>
        </div></ToolbarOutlet>
        <textarea
          className="markdown-editor"
          aria-label="正文源码"
          value={String(value.source)}
          spellCheck={false}
          onChange={(e) => changeSource(e.target.value)}
          onDragOver={allowFileDrop}
          onDrop={event => {
            if (!hasDroppedFiles(event.dataTransfer)) return;
            event.preventDefault(); event.stopPropagation();
            const position = { offset: event.currentTarget.selectionStart }; sourceDrops.current.push(position);
            uploads.upload(Array.from(event.dataTransfer.files), (row, file) => {
              const source = String(current.current.value.source), offset = Math.min(source.length, position.offset);
              const image = document.createElement('img'); image.src = row.value.url; image.alt = row.value.alt ?? file.name;
              const text = current.current.value.format === 'html' ? image.outerHTML : `![${image.alt.replace(/[\\[\]]/g, '\\$&')}](${row.value.url})`;
              changeSource(source.slice(0, offset) + '\n\n' + text + '\n\n' + source.slice(offset));
              position.offset = offset + text.length + 4;
            });
          }}
        />
        <UploadStatus uploads={uploads}/>
      </div>
    );
  return (
    <div className="document-editor" onBeforeInputCapture={markEditing} onInputCapture={markEditing} onKeyDownCapture={markEditing} onPasteCapture={markEditing} onDropCapture={markEditing} onClickCapture={event => { if ((event.target as Element).closest('button')) markEditing(); }}>
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
            HorizontalRuleNode,
            EmbedNode,
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
          onEdit={markEditing}
          target={toolbarTarget}
          compact={compact}
          uploading={uploads.busy || uploads.failed.length > 0}
          onMode={(source) => {
            onChange({ version: 1, format: 'markdown', source });
            setMode('source');
          }}
          onMedia={onMedia}
        />
        <div className="editor-canvas">
          <RichTextPlugin
            contentEditable={<ContentEditable className="visual-editor" aria-label="正文编辑器" />}
            placeholder={<span className="editor-placeholder">{placeholder}</span>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <FileDropPlugin uploads={uploads}/>
        {compact&&<AutoFocusPlugin/>}
        <ListPlugin />
        <LinkPlugin />
        <TablePlugin hasCellMerge={false} />
        <TableTools />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state) => {
            // Initial list normalization and focus are not owner edits.
            if (!editing.current) return;
            if (outputFormat === 'markdown') state.read(() => onChange({ version: 1, format: 'markdown', source: $convertToMarkdownString(transformers) }));
            else onChange({ version: 1, format: 'lexical', source: state.toJSON() as any });
          }}
        />
      </LexicalComposer>
      <UploadStatus uploads={uploads}/>
    </div>
  );
}
