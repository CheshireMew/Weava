import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

interface PopoverOptions {
  open: unknown;
  trigger: RefObject<HTMLElement | null>;
  popup: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'start' | 'end';
  gap?: number;
  initialFocus?: string | false;
  anchorRect?: Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right'>;
}
/** Shared positioning, dismissal, focus restoration and menu navigation. */
export function usePopover({
  open,
  trigger,
  popup,
  onClose,
  align = 'end',
  gap = 8,
  initialFocus = 'input,select,button',
  anchorRect,
}: PopoverOptions) {
  const latest = useRef(onClose);
  latest.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 500 });
  const close = useCallback(
    (restore = false) => {
      latest.current();
      if (restore) trigger.current?.focus({ preventScroll: true });
    },
    [trigger],
  );
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const anchor = anchorRect ?? trigger.current.getBoundingClientRect(),
      bounds = popup.current.getBoundingClientRect();
    const top =
      anchor.bottom + gap + bounds.height < window.innerHeight - 12
        ? anchor.bottom + gap
        : Math.max(12, anchor.top - bounds.height - gap);
    setPosition({
      top,
      left: Math.max(
        12,
        Math.min(
          align === 'start' ? anchor.left : anchor.right - bounds.width,
          window.innerWidth - bounds.width - 12,
        ),
      ),
      maxHeight: Math.max(0, window.innerHeight - top - 12),
    });
    if (initialFocus) (
      popup.current.querySelector<HTMLElement>(initialFocus) ??
      popup.current.querySelector<HTMLElement>('button,select')
    )?.focus({ preventScroll: true });
  }, [open, align, gap, initialFocus, trigger, popup, anchorRect]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const resize = () => close();
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close();
    };
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
  }, [open, close, trigger, popup]);
  function menuKeyDown(event: KeyboardEvent, selector = 'button:not(:disabled)') {
    if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...popup.current!.querySelectorAll<HTMLElement>(selector)],
      index = items.indexOf(document.activeElement as HTMLElement);
    items[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    ]?.focus();
  }
  return {
    position,
    close,
    menuKeyDown,
    portalTarget: trigger.current?.closest('dialog') ?? document.body,
  };
}
