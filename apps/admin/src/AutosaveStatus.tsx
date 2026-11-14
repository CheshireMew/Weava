import { Loader2 } from 'lucide-react';
import type { AutosaveState } from './useAutosave.ts';

export function AutosaveStatus({ state, label = '', savedText = '已保存', savingText = '正在保存' }: { state: AutosaveState; label?: string; savedText?: string; savingText?: string }) {
  return <span className={'autosave-status ' + state.phase} role="status" title={state.error || undefined}>
    {state.phase === 'saving' ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <span className="autosave-dot" aria-hidden="true" />}
    {state.phase === 'error' ? <><span>{state.error || '保存失败'}</span><button type="button" aria-label={'重试保存' + label} onClick={() => { void state.retry().catch(() => {}); }}>重试</button></>
      : state.phase === 'offline' ? '离线，有未同步修改' : state.phase === 'retrying' ? '连接中断，等待重试' : state.phase === 'saving' ? savingText : state.phase === 'incomplete' ? state.error : state.phase === 'pending' ? '待保存' : savedText}
  </span>;
}
