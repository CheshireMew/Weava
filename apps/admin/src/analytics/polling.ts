export function watchVisible<T>(
  read: () => Promise<T>,
  onValue: (value: T) => void,
  onError: (message: string) => void,
  interval: number,
) {
  let pending = false,
    stopped = false;
  const refresh = async () => {
    if (pending || stopped || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const value = await read();
      if (!stopped) onValue(value);
    } catch (error: any) {
      if (!stopped) onError(error.message);
    } finally {
      pending = false;
    }
  };
  const visibility = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  const timer = setInterval(refresh, interval);
  document.addEventListener('visibilitychange', visibility);
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
