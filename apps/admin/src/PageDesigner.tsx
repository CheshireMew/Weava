import { useEffect, useRef, useState } from 'react';
import type { Block } from '@weava/contracts';
import { Blocks, BlockProperties, type BlockCatalog } from './Blocks.tsx';
import { findBlock, patchBlock } from './block-tree.ts';

export function PageDesigner({ entryId, value, onChange, save, onError, catalog, layoutId, initialRevision, previewKey }: {
  entryId: string; value: Block[]; onChange: (blocks: Block[]) => void;
  save: () => Promise<any>; onError: (message: string) => void; catalog: BlockCatalog;
  layoutId?: string; initialRevision?: number; previewKey?: string;
}) {
  const [selected, setSelected] = useState(''), [width, setWidth] = useState(1100), [src, setSrc] = useState(''), [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false), [scale, setScale] = useState(1);
  const canvas = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null), latest = useRef({ value, onChange, save, onError });
  latest.current = { value, onChange, save, onError };
  const serialized = JSON.stringify(value);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setLoading(true); const row = await latest.current.save();
        if (active) setSrc('/__preview/' + encodeURIComponent(entryId) + '?editor=1&revision=' + (row?.entryRevision ?? row?.revision ?? initialRevision ?? '') + (layoutId ? '&layout=' + encodeURIComponent(layoutId) : '') + '&v=' + Date.now());
      } catch (error: any) { if (active) latest.current.onError(error.message); }
      finally { if (active) setLoading(false); }
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [serialized, entryId, layoutId, previewKey]);
  useEffect(() => {
    const resize = () => setScale(Math.min(1, (canvas.current?.clientWidth ?? width) / width));
    const observer = new ResizeObserver(resize); if (canvas.current) observer.observe(canvas.current); resize();
    return () => observer.disconnect();
  }, [width, expanded]);
  const highlight = () => {
    const document = iframe.current?.contentDocument;
    document?.querySelectorAll('[data-weava-block]').forEach((node) => node.classList.toggle('weava-selected', node.getAttribute('data-weava-block') === selected));
  };
  useEffect(highlight, [selected, src]);
  const loaded = () => {
    const document = iframe.current?.contentDocument;
    if (!document?.body) return;
    const style = document.createElement('style');
    style.textContent = '[data-weava-block]{position:relative;min-height:24px;cursor:pointer}[data-weava-block]:hover{outline:1px dashed #497c65;outline-offset:3px}.weava-selected{outline:2px solid #315c4c!important;outline-offset:3px}[contenteditable]{cursor:text!important;outline:2px solid #315c4c!important}';
    document.head.append(style);
    document.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (!target.closest('[contenteditable]')) event.preventDefault();
      const id = target.closest('[data-weava-block]')?.getAttribute('data-weava-block');
      if (id && findBlock(latest.current.value, id)) setSelected(id);
    }, true);
    document.addEventListener('dblclick', (event) => {
      const target = (event.target as Element).closest('[data-weava-edit]') as HTMLElement | null;
      if (!target) return;
      const [id, key] = target.getAttribute('data-weava-edit')!.split(':');
      const block = findBlock(latest.current.value, id);
      if (!block || block.bindings?.[key]) return;
      event.preventDefault(); target.contentEditable = 'plaintext-only'; target.focus();
      target.addEventListener('blur', () => {
        target.removeAttribute('contenteditable');
        const current = findBlock(latest.current.value, id);
        if (current) latest.current.onChange(patchBlock(latest.current.value, id, { props: { ...current.props, [key]: target.textContent ?? '' } }));
      }, { once: true });
    });
    highlight();
  };
  const active = findBlock(value, selected);
  return <div className={'page-designer' + (expanded ? ' expanded' : '')}>
    <div className="designer-top"><div className="viewport-controls" aria-label="预览宽度">{[[1100, '桌面'], [768, '平板'], [390, '手机']].map(([size, label]) => <button key={size} aria-pressed={width === size} onClick={() => setWidth(Number(size))}>{label}</button>)}</div>{loading && <span role="status">正在更新预览…</span>}<button onClick={() => setExpanded(!expanded)}>{expanded ? '收起画布' : '展开画布'}</button></div>
    <div className="designer-workspace">
      <aside className="designer-outline"><Blocks value={value} onChange={onChange} catalog={catalog} selectedId={selected} onSelect={setSelected} outlineOnly allowBody={!!layoutId} /></aside>
      <div className="designer-canvas" ref={canvas}><div style={{ width: width * scale, height: 900 * scale, marginInline: 'auto' }}>{src ? <iframe style={{ width, height: 900, transform: `scale(${scale})`, transformOrigin: 'top left' }} ref={iframe} title="页面画布" src={src} sandbox="allow-same-origin" onLoad={loaded} /> : <p>正在准备画布…</p>}</div></div>
      <aside className="designer-inspector">{active ? <><h3>{catalog.layouts?.find((row) => row.id === active.props.layoutId)?.value.label ?? '区块设置'}</h3><BlockProperties value={active} catalog={catalog} onChange={(block) => onChange(patchBlock(value, block.id, block))} /></> : <p>选择页面中的区块</p>}</aside>
    </div>
  </div>;
}
