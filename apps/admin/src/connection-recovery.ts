/** Only transport failures and temporary gateway errors are safe to retry automatically. */
export const connectionFailure = (error: unknown) =>
  !!error && typeof error === 'object' && 'status' in error &&
  [0, 502, 503, 504].includes(Number(error.status));

export const connectionOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** A failed request may precede the browser's offline event, or never produce one. */
export function retryConnection(retry: () => void, attempt = 0) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => { cleanup(); retry(); };
  const online = () => { if (connectionOnline()) run(); };
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', online);
  };
  window.addEventListener('online', online);
  timer = setTimeout(() => {
    if (connectionOnline()) run();
  }, Math.min(30000, 2000 * 2 ** Math.min(attempt, 4)));
  return cleanup;
}
