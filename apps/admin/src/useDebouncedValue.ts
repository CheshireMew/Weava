import { useEffect, useState } from 'react';

export function useDebouncedValue(value: string, delay = 180, scope = '') {
  const [settled, setSettled] = useState({ value, scope });
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled({ value, scope }), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay, scope]);
  return value === '' || settled.scope !== scope ? value : settled.value;
}
