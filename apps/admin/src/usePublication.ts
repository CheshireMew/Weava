import { useRef, useState } from 'react';
import { api, waitJob } from './api.ts';
import type { ApiOutput } from '@weava/contracts/api';
export function usePublication(
  refresh: () => Promise<any>,
  setError: (message: string) => void,
  notify: (message: string) => void,
) {
  const [busy, setBusy] = useState(false),
    [job, setJob] = useState<any>(null),
    [publication, setPublication] = useState<ApiOutput<'publication'> | null>(null);
  const active = useRef(false);
  async function task(
    operation: 'publish' | 'backup' | 'verify',
    payload: any = {},
    reviewed = false,
  ) {
    if (active.current) return;
    active.current = true;
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
      // The job is committed. A failed display refresh must not report a failed publication.
      void refresh().catch(error => setError('操作已完成，刷新页面数据失败：' + error.message));
      notify(operation === 'publish' ? '已发布' : operation === 'backup' ? '备份已创建' : '备份检查完成');
      return result;
    } catch (e: any) {
      setJob(null);
      setError(e.message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, job, setJob, publication, setPublication, task };
}
export type PublicationController = ReturnType<typeof usePublication>;
