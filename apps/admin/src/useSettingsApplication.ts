import { useEffect, useRef, useState } from 'react';
import { api, waitJob } from './api.ts';
import type { AutosaveState } from './useAutosave.ts';
import { adminQueries } from './query-cache.ts';

/** Keep publication in order while forms remain free to save newer settings. */
export class SettingsApplication {
  private requested = 0;
  private applied = 0;
  private running: Promise<void> | null = null;
  state: AutosaveState = { phase: 'saved', error: '', retry: () => this.flush() };
  constructor(private apply: () => Promise<void>, private changed: () => void, private completed: () => void = () => {}) {}
  private status(phase: AutosaveState['phase'], error = '') {
    this.state = { phase, error, retry: () => this.flush() }; this.changed();
  }
  request = () => { this.requested++; void this.flush().catch(() => {}); };
  resumePending = () => { if (!this.requested) this.request(); };
  flush = async (): Promise<void> => {
    if (this.running) return this.running;
    if (this.applied === this.requested) return;
    this.status('saving');
    this.running = (async () => {
      let retryConflict = true;
      while (this.applied < this.requested) {
        const version = this.requested;
        try { await this.apply(); this.applied = version; retryConflict = true; }
        catch (error: any) {
          if (this.requested > version) continue;
          if (error.status === 409 && retryConflict) { retryConflict = false; continue; }
          this.status('error', '设置已保存，更新网站失败：' + error.message);
          throw error;
        }
      }
      this.status('saved');
      this.completed();
    })().finally(() => { this.running = null; });
    return this.running;
  };
}

export function useSettingsApplication(refresh: () => Promise<any>, onApplied?: () => void,onRefreshError?:(message:string)=>void) {
  const latest = useRef({ refresh, onApplied,onRefreshError }); latest.current = { refresh, onApplied,onRefreshError };
  const [, render] = useState(0), mounted = useRef(true);
  const controller = useRef<SettingsApplication | null>(null);
  if (!controller.current) controller.current = new SettingsApplication(async () => {
    // A quick toggle back to the current public value needs no new release.
    const path = 'state?summary=1&panel=appearance';
    const state = await adminQueries.read(path, () => api(path));
    if ((!state.features || state.features.includes('content')) && (state.settingsPending || state.termsPending)) {
      let progress: any;
      try { await waitJob(await api('publish', { scope: 'settings' }), job => { progress = job; }); }
      catch (error: any) { throw Object.assign(error, { status: progress?.errorStatus ?? error.status }); }
    }
    void latest.current.refresh().catch(error=>latest.current.onRefreshError?.('设置已生效，刷新页面数据失败：'+error.message));
  }, () => { if (mounted.current) render(value => value + 1); }, () => { if (mounted.current) latest.current.onApplied?.(); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return controller.current;
}
