import { useEffect, useRef, useState } from 'react';
export function useAdminShell() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(message: string, duration = 3000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), duration);
  }
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)'),
      update = () => {
        setCompact(media.matches);
        setMenu(false);
      };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  return { compact, menu, setMenu, toast, setToast, notify };
}
export function useSiteIcon(siteLogo: string | undefined) {
  useEffect(() => {
    if (siteLogo === undefined) return;
    let icon = document.head.querySelector<HTMLLinkElement>('link[data-weava-site-icon]');
    if (!siteLogo) {
      icon?.remove();
      return;
    }
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      icon.dataset.weavaSiteIcon = '';
      document.head.append(icon);
    }
    icon.href = siteLogo;
  }, [siteLogo]);
}
