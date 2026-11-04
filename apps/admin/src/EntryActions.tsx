import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Dialog } from './Dialog.tsx';
import type { ContentWorkspace } from './useContentWorkspace.ts';

export function EntryActions({ row, model, disabled }: { row: any; model: ContentWorkspace; disabled: boolean }) {
  const [open, setOpen] = useState(false), [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const title = row.value.title || '无标题';
  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!.getBoundingClientRect(), popup = menu.current!;
    const bounds = popup.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12)),
      top: anchor.bottom + 6 + bounds.height <= window.innerHeight - 12
        ? anchor.bottom + 6 : Math.max(12, anchor.top - bounds.height - 6),
    });
    popup.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) closeMenu();
    }
    const dismiss = () => closeMenu();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  async function duplicate() {
    closeMenu(true);
    setPending(true);
    try { await model.duplicateEntry(row); }
    catch (error: any) { model.setError(error.message); }
    finally { setPending(false); }
  }
  async function remove() {
    setPending(true);
    setError('');
    try { await model.deleteEntry(row); setConfirming(false); }
    catch (error: any) { setError(error.message); }
    finally { setPending(false); }
  }
  return <>
    <button ref={trigger} className="publication-actions-trigger" aria-label={'更多操作：' + title}
      title="更多操作" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled || pending} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <MoreHorizontal size={22} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="publication-actions-menu" role="menu" aria-label={title + '的操作'} style={position}
      onKeyDown={event => {
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
        if (event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      <button role="menuitem" onClick={() => { closeMenu(true); void model.select(row.id); }}><Pencil size={19} aria-hidden="true" />编辑</button>
      <button role="menuitem" onClick={duplicate}><Copy size={19} aria-hidden="true" />复制</button>
      <div className="publication-actions-divider" role="separator" />
      <button role="menuitem" className="publication-delete" onClick={() => { closeMenu(true); setError(''); setConfirming(true); }}><Trash2 size={19} aria-hidden="true" />删除</button>
    </div>, document.body)}
    {confirming && <Dialog label="删除内容" className="modal entry-delete-dialog" onClose={() => setConfirming(false)} dismissible={!pending}>
      <h2>删除“{title}”？</h2>
      <p>删除后将从内容库移除，无法在内容库中恢复。已发布内容会同时从网站撤下。</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="entry-delete-actions">
        <button data-autofocus disabled={pending} onClick={() => setConfirming(false)}>取消</button>
        <button className="publication-delete-confirm" disabled={pending} onClick={remove}>{pending ? '正在删除…' : '删除'}</button>
      </div>
    </Dialog>}
  </>;
}
