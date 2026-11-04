import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Block } from '@weava/contracts';
import { BlockProperties, type BlockCatalog } from './Blocks.tsx';
import { patchBlock } from './block-tree.ts';
import { useSelectors } from './Selectors.tsx';

const Editor = lazy(() => import('./Editor.tsx').then(module => ({ default: module.Editor })));

/** Edit an imported HTML fragment in place, retaining its surrounding markup.
 * The isolated document cannot execute imported scripts or event handlers. */
export function HtmlPageText({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null), current = useRef({ value, onChange });
  current.current = { value, onChange };
  const applied = useRef(value), selectedImage = useRef<HTMLImageElement | null>(null);
  const savedSelection = useRef<Range | null>(null), observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(260), [imageSelected, setImageSelected] = useState(false);
  const [initial] = useState(value);
  const selectors = useSelectors();
  const body = () => frame.current?.contentDocument?.getElementById('page-text');
  const changed = () => {
    const editor = body();
    if (editor) { applied.current = editor.innerHTML; current.current.onChange(editor.innerHTML); }
  };
  useEffect(() => {
    const editor = body();
    if (editor && value !== applied.current) { editor.innerHTML = value; applied.current = value; }
  }, [value]);
  useEffect(() => () => observer.current?.disconnect(), []);
  const rememberSelection = () => {
    const selection = frame.current?.contentWindow?.getSelection();
    savedSelection.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  };
  const restoreSelection = () => {
    const editor = body(), selection = frame.current?.contentWindow?.getSelection();
    editor?.focus();
    if (savedSelection.current && selection) { selection.removeAllRanges(); selection.addRange(savedSelection.current); }
  };
  const command = (name: string, argument?: string) => {
    restoreSelection(); frame.current?.contentDocument?.execCommand(name, false, argument); changed();
  };
  return <div className="page-html-editor">
    <div className="page-text-toolbar" role="toolbar" aria-label="网页正文格式">
      <button type="button" onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('bold')}>加粗</button>
      <button type="button" onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('italic')}>斜体</button>
      <button type="button" onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => { const url = window.prompt('链接网址'); if (url) command('createLink', url); }}>链接</button>
      <button type="button" onMouseDown={rememberSelection} onClick={async () => {
        const image = selectedImage.current, media = await selectors.media('image');
        if (!media) return;
        if (image?.isConnected) {
          image.setAttribute('src', media.url); image.setAttribute('alt', media.alt ?? media.name);
          for (const attribute of ['srcset', 'sizes', 'data-src', 'data-srcset', 'data-lazy']) image.removeAttribute(attribute);
          changed();
        }
        else {
          const element = frame.current!.contentDocument!.createElement('img');
          element.setAttribute('src', media.url); element.setAttribute('alt', media.alt ?? media.name);
          command('insertHTML', element.outerHTML);
        }
      }}>{imageSelected ? '更换图片' : '插入图片'}</button>
    </div>
    <iframe ref={frame} title="网页正文编辑器" sandbox="allow-same-origin" style={{ height }}
      srcDoc={`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html{font:16px/1.8 system-ui,sans-serif;color:#222;background:#fff}body{margin:0;padding:20px}main{min-height:210px;outline:none;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}a{color:#285e9c}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body><main id="page-text" contenteditable="true" role="textbox" aria-label="网页正文" aria-multiline="true">${initial}</main></body></html>`}
      onLoad={() => {
        const editor = body(), doc = frame.current?.contentDocument;
        if (!editor || !doc) return;
        // Keep source bytes unchanged until an actual editing event occurs.
        if (current.current.value !== initial) editor.innerHTML = current.current.value;
        editor.addEventListener('input', changed);
        editor.addEventListener('click', event => {
          if ((event.target as Element).closest('a')) event.preventDefault();
          const image = (event.target as Element).closest('img');
          selectedImage.current = image; setImageSelected(!!image);
        });
        observer.current?.disconnect();
        observer.current = new ResizeObserver(() => setHeight(Math.max(260, doc.body.scrollHeight)));
        observer.current.observe(doc.body);
      }} />
  </div>;
}

export function ImportedContentEditor({ value, onChange, catalog, onError }: {
  value: Block[]; onChange: (blocks: Block[]) => void; catalog: BlockCatalog;
  onError: (message: string) => void;
}) {
  const selectors = useSelectors();
  const render = (blocks: Block[]): React.ReactNode => blocks.map(block => {
    if (['entry-heading', 'divider', 'spacer'].includes(block.type)) return null;
    if (['container', 'columns'].includes(block.type)) return <div key={block.id}>{render(block.children ?? [])}</div>;
    const update = (next: Block) => onChange(patchBlock(value, block.id, next));
    if (['text', 'richtext'].includes(block.type) && !block.bindings?.text) {
      const text = String(block.props.text ?? '');
      const change = (text: string) => update({ ...block, props: { ...block.props, text } });
      return <div className="page-content-section" key={block.id}>{/<\/?[a-z][^>]*>/i.test(text)
        ? <HtmlPageText value={text} onChange={change} />
        : <Suspense fallback={<p>正在打开正文…</p>}><Editor value={{ version: 1, format: 'markdown', source: text }} outputFormat="markdown" onChange={document => change(String(document.source))} onMedia={() => selectors.media()} onError={onError} /></Suspense>}</div>;
    }
    if (['entry-body', 'entry-fields', 'entry-toc', 'site-brand', 'navigation'].includes(block.type)) return null;
    if (['content-list', 'cards', 'taxonomy', 'shared', 'content-detail', 'compatibility', 'code'].includes(block.type) || !['hero', 'image-text', 'image', 'gallery', 'video', 'attachment', 'button', 'faq', 'callout'].includes(block.type))
      return <div className="page-content-section page-automatic-content" key={block.id}><span>{['content-list', 'cards', 'taxonomy'].includes(block.type) ? '自动更新的内容列表' : '自定义内容'}</span></div>;
    return <div className="page-content-section" key={block.id}><BlockProperties value={block} onChange={update} catalog={catalog} contentOnly />{block.children && render(block.children)}</div>;
  });
  return <div className="page-content-editor">{render(value)}</div>;
}
