import { useSyncExternalStore } from 'react';
import { subscribeTasks, taskSnapshot } from './task-tracker.ts';
export {
  startTask,
  trackTask,
  awaitTask,
  taskPending,
  refreshBackgroundTasks,
} from './task-tracker.ts';
export type { BackgroundTask } from './task-tracker.ts';

export function useBackgroundTasks(scope?: string) {
  const all = useSyncExternalStore(subscribeTasks, taskSnapshot, taskSnapshot);
  return scope ? all.filter((task) => task.scope === scope) : all;
}
