import { useState } from 'react';
import { api, waitJob } from './api.ts';
export function usePublication(
  refresh: () => Promise<any>,
  setError: (message: string) => void,
  notify: (message: string) => void,
) {
  const [busy, setBusy] = useState(false),
    [job, setJob] = useState<any>(null),
    [publication, setPublication] = useState<any>(null);
  async function task(
    operation: 'publish' | 'backup' | 'verify',
    payload: any = {},
    reviewed = false,
  ) {
    setBusy(true);
    setError('');
    try {
      if (operation === 'publish' && !reviewed) {
        const review = await api('publication', payload);
        setPublication(review);
        return review;
      }
      const result = await waitJob(await api(operation, payload), setJob);
      setJob(null);
      await refresh();
      notify('操作已完成');
      return result;
    } catch (e: any) {
      setJob(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, job, setJob, publication, setPublication, task };
}
export type PublicationController = ReturnType<typeof usePublication>;
