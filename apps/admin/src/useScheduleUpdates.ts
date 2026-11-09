import { useEffect } from 'react';
import { api } from './api.ts';
import type { ContentState, EntryRecord } from './content-models.ts';
export function useScheduleUpdates(
  schedules: ContentState['schedules'],
  currentEntry: () => EntryRecord | null,
  receiveSchedules: (rows: ContentState['schedules']) => void,
  setError: (message: string) => void,
) {
  const dueAt=Math.min(...schedules.filter(row=>['scheduled','running'].includes(row.value.status)).map(row=>Date.parse(row.value.dueAt)));
  const pendingSchedule=Number.isFinite(dueAt);
  useEffect(() => {
    if (!pendingSchedule) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const entryId = currentEntry()?.id;
        const schedules = await api(
          currentEntry()
            ? `schedules?entryId=${encodeURIComponent(currentEntry()!.id)}`
            : 'schedules',
        );
        if (active && currentEntry()?.id === entryId) receiveSchedules(schedules);
      } catch (error: any) {
        if (active) setError(error.message);
      } finally {
        if (active) timer = setTimeout(poll,document.hidden?5000:Date.now()-dueAt<3000?250:3000);
      }
    };
    timer = setTimeout(poll,Math.min(5000,Math.max(0,dueAt-Date.now()+150)));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingSchedule,dueAt]);
}
