import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Popover({ label, trigger, children, className = '', menu = false, align = 'end' }: {
  label: string; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); className?: string; menu?: boolean; align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 500 });
  const button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), id = useId();
  const close = (restore = false) => { setOpen(false); if (restore) button.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current!.getBoundingClientRect(), bounds = popup.current!.getBoundingClientRect();
    const top = anchor.bottom + 8 + bounds.height < window.innerHeight - 12 ? anchor.bottom + 8 : Math.max(12, anchor.top - bounds.height - 8);
    setPosition({ top, left: Math.max(12, Math.min(align === 'start' ? anchor.left : anchor.right - bounds.width, window.innerWidth - bounds.width - 12)), maxHeight: window.innerHeight - top - 12 });
    popup.current!.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    const resize = () => close();
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  return <>
    <button ref={button} type="button" aria-label={label} aria-haspopup={menu ? 'menu' : 'dialog'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && createPortal(<div ref={popup} id={id} role={menu ? 'menu' : 'dialog'} aria-label={label} className={'admin-popover ' + className} style={position}
      onClick={event => { if (menu && (event.target as Element).closest('button')) close(true); }}
      onKeyDown={event => {
        if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...popup.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], current = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }}>{typeof children === 'function' ? children(() => close(true)) : children}</div>, document.body)}
  </>;
}
