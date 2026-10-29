import { useEffect, useState } from 'react';

export function useDebouncedValue(value: string, delay = 180) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return value === '' ? '' : settled;
}
