import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$getNodeByKey, $nodesOfType} from 'lexical';
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
    const visible=new Set<string>(),observed=new Map<Element,string>();
    const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
      for(const entry of entries){const key=observed.get(entry.target);if(key){if(entry.isIntersecting)visible.add(key);else visible.delete(key);}}
      schedule();
    },{rootMargin:'300px'}):undefined;
    const measure = () => {
      const root = editor.getRootElement(), host = root?.closest<HTMLElement>('.editor-canvas');
      if (!host) return;
      setCanvas(host);
      const keys=[...visible];
      const bounds = keys.length?host.getBoundingClientRect():{top:0,right:0};
      const next = editor.getEditorState().read(() => keys.flatMap(key => {
        const node=$getNodeByKey(key);if(!(node instanceof CodeNode))return [];
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
      // Small documents have no offscreen layout cost and expose controls immediately.
      if(root&&root.children.length<1000){editor.getEditorState().read(()=>$nodesOfType(CodeNode).forEach(node=>visible.add(node.getKey())));measure();}
      schedule();
    });
    const unregisterNodes=editor.registerMutationListener(CodeNode,mutations=>{
      for(const [key,kind] of mutations){
        for(const [element,old] of observed)if(old===key&&(kind==='destroyed'||element!==editor.getElementByKey(key))){intersection?.unobserve(element);observed.delete(element);visible.delete(key);}
        if(kind==='destroyed')continue;
        const element=editor.getElementByKey(key);if(!element)continue;
        if(!observed.has(element)){observed.set(element,key);intersection?.observe(element);}
        if(!intersection||(editor.getRootElement()?.children.length??0)<1000)visible.add(key);
      }
      if(visible.size)measure();schedule();
    });
    const unregisterUpdate = editor.registerUpdateListener(() => { if(visible.size)schedule(); });
    window.addEventListener('scroll',schedule,true);
    return () => { unregisterRoot(); unregisterNodes(); unregisterUpdate(); intersection?.disconnect();window.removeEventListener('scroll',schedule,true);observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer.current); };
  }, [editor]);
  return canvas && createPortal(<div className="editor-code-controls">{blocks.map(block => <button type="button" className="editor-code-copy" key={block.key} aria-label="复制代码" style={{top: block.top, right: block.right}}
    onMouseDown={event => event.preventDefault()} onClick={async () => {
      try { await navigator.clipboard.writeText(block.text); setCopied(block.key); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(''), 1600); }
      catch { onError('未能复制代码，请重新点击复制，或选中代码后复制。'); }
    }}>{copied === block.key ? '已复制' : '复制'}</button>)}</div>, canvas);
}
