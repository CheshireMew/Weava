import { sameEditableValue } from './edit-session.ts';

/** Preserve independent updates (for example, a category rename updating site metadata). */
export function mergeSettingDraft(base: any, local: any, remote: any): any {
  if (sameEditableValue(local, base)) return remote;
  if (sameEditableValue(remote, base) || sameEditableValue(local, remote)) return local;
  if (base && local && remote && [base, local, remote].every(value => typeof value === 'object' && !Array.isArray(value))) {
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeSettingDraft(base[key], local[key], remote[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  throw new Error('同一项设置已在其他窗口修改，当前输入仍保留，请重新打开设置后再处理。');
}
