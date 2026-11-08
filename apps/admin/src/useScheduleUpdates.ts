import { useEffect } from 'react';
import { api } from './api.ts';
import type { ContentState, EntryRecord } from './content-models.ts';
export function useScheduleUpdates(
  schedules: ContentState['schedules'],
  currentEntry: () => EntryRecord | null,
  receiveSchedules: (rows: ContentState['schedules']) => void,
  setError: (message: string) => void,
) {
  const pendingSchedule = schedules.some((row) => row.value.status === 'scheduled');
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
        if (active) timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingSchedule]);
}
