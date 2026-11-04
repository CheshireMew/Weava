import { Loader2 } from 'lucide-react';
import type { AutosaveState } from './useAutosave.ts';

export function AutosaveStatus({ state, label = '' }: { state: AutosaveState; label?: string }) {
  return <span className={'autosave-status ' + state.phase} role="status" title={state.error || undefined}>
    {state.phase === 'saving' ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <span className="autosave-dot" aria-hidden="true" />}
    {state.phase === 'error' ? <><span>保存失败</span><button type="button" aria-label={'重试保存' + label} onClick={() => { void state.retry().catch(() => {}); }}>重试</button></>
      : state.phase === 'saving' ? '正在保存' : state.phase === 'pending' ? '待保存' : '已保存'}
  </span>;
}
