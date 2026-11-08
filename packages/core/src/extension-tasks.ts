import type { Extension } from './extensions.ts';

/** Owns timer and in-flight task lifetimes; lifecycle state is only a predicate. */
export class ExtensionTasks {
  private timers = new Set<ReturnType<typeof setInterval>>();
  private tasks = new Set<Promise<unknown>>();
  private paused = true;
  private disposed = false;
  constructor(
    private canRun: () => boolean,
    private onError: (id: string, message: string) => void,
  ) {}
  get pending() {
    return this.tasks.size;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  start(extension: Extension) {
    this.disposed = false;
    for (const task of extension.schedules ?? []) {
      let running = false;
      const timer = setInterval(() => {
        if (running || this.paused || this.disposed || !this.canRun()) return;
        running = true;
        const work = Promise.resolve()
          .then(task.run)
          .catch((error) => this.onError(extension.id, task.id + '：' + error.message))
          .finally(() => {
            running = false;
            this.tasks.delete(work);
          });
        this.tasks.add(work);
      }, task.intervalMs);
      timer.unref();
      this.timers.add(timer);
    }
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }
  async stop() {
    this.dispose();
    await Promise.allSettled(this.tasks);
  }
}
