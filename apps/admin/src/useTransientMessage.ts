import { useEffect, useRef } from 'react';

/** Feedback belongs to the view that produced it, and expires on its own. */
export function useTransientMessage(value: string, clear: () => void, context: string, duration = 4500) {
  const action = useRef(clear); action.current = clear;
  const previous = useRef({context,value});
  useEffect(() => {
    if (!value || duration <= 0) return;
    const timer = setTimeout(() => action.current(), duration);
    return () => clearTimeout(timer);
  }, [value, duration]);
  useEffect(() => {
    const before=previous.current;
    previous.current={context,value};
    if(before.context!==context&&value&&value===before.value)action.current();
  }, [context, value]);
}
