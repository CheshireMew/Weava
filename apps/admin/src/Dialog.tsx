import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function Dialog({ children, label, className = 'modal', onClose, dismissible = true }: {
  children: ReactNode;
  label: string;
  className?: string;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={(event) => {
    event.preventDefault();
    if (dismissible) onClose();
  }}>{children}</dialog>;
}
