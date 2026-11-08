import { useEffect, useRef } from 'react';

/** Feedback belongs to the view that produced it, and expires on its own. */
export function useTransientMessage(value: string, clear: () => void, context: string, duration = 4500) {
  const action = useRef(clear); action.current = clear;
  const previousContext = useRef(context);
  useEffect(() => {
    if (!value || duration <= 0) return;
    const timer = setTimeout(() => action.current(), duration);
    return () => clearTimeout(timer);
  }, [value, duration]);
  useEffect(() => {
    if (previousContext.current !== context) {
      previousContext.current = context;
      if (value) action.current();
    }
  }, [context, value]);
}
