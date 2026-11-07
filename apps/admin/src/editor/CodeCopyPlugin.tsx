import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$nodesOfType} from 'lexical';
import {CodeNode} from '@lexical/code';

interface CodeBlock { key: string; text: string; top: number; right: number }

/** Controls live outside contenteditable, so copying never becomes an authored edit. */
export function CodeCopyPlugin({onError}: {onError: (message: string) => void}) {
  const [editor] = useLexicalComposerContext();
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [blocks, setBlocks] = useState<CodeBlock[]>([]);
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const root = editor.getRootElement(), host = root?.closest<HTMLElement>('.editor-canvas');
      if (!host) return;
      setCanvas(host);
      const bounds = host.getBoundingClientRect();
      const next = editor.getEditorState().read(() => $nodesOfType(CodeNode).flatMap(node => {
        const element = editor.getElementByKey(node.getKey());
        if (!element) return [];
        const box = element.getBoundingClientRect();
        return [{key: node.getKey(), text: node.getTextContent(), top: box.top - bounds.top + 8, right: bounds.right - box.right + 8}];
      }));
      setBlocks(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    const unregisterRoot = editor.registerRootListener(root => {
      observer.disconnect();
      if (root) { observer.observe(root); if (root.parentElement) observer.observe(root.parentElement); }
      measure(); schedule();
    });
    const unregisterUpdate = editor.registerUpdateListener(() => { measure(); schedule(); });
    return () => { unregisterRoot(); unregisterUpdate(); observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer.current); };
  }, [editor]);
  return canvas && createPortal(<div className="editor-code-controls">{blocks.map(block => <button type="button" className="editor-code-copy" key={block.key} aria-label="复制代码" style={{top: block.top, right: block.right}}
    onMouseDown={event => event.preventDefault()} onClick={async () => {
      try { await navigator.clipboard.writeText(block.text); setCopied(block.key); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(''), 1600); }
      catch { onError('未能复制代码，请重新点击复制，或选中代码后复制。'); }
    }}>{copied === block.key ? '已复制' : '复制'}</button>)}</div>, canvas);
}
