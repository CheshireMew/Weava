import { useEffect, useRef } from 'react';
import type { Revision, Settings, Term } from '@weava/contracts';
import { useManagedRecord } from './EditSessions.tsx';
import { sameEditableValue } from './edit-session.ts';
import { api } from './api.ts';
import { AutosaveStatus } from './AutosaveStatus.tsx';

export interface SiteSettingProps {
  settings: Revision<Settings>;
  saveSettings: (value: Settings, revision: number) => Promise<Revision<Settings>>;
  publishSettings: () => Promise<any>;
  onError: (message: string) => void;
  pendingApplication?: boolean;
}
function useSiteSetting({ settings, saveSettings }: SiteSettingProps, label: string, field: 'taxonomies' | 'commentModeration') {
  const baseline = useRef(settings);
  const managed = useManagedRecord(settings, async row => {
    const latest = await api('settings');
    if (!sameEditableValue(latest.value[field], baseline.current.value[field]))
      throw new Error('这项设置已在其他页面修改，请重新打开后再保存。');
    const saved = await saveSettings({ ...latest.value, [field]: row.value[field] }, latest.revision);
    baseline.current = saved;
    return saved;
  }, label, { autosave: true });
  useEffect(() => {
    if (!managed.session.dirty) baseline.current = settings;
    managed.session.receive(settings);
  }, [settings]);
  return managed;
}

export function CommentSettings(props: SiteSettingProps) {
  const managed = useSiteSetting(props, '评论设置', 'commentModeration');
  return <details className="settings-disclosure"><summary>评论设置</summary>
    <AutosaveStatus state={managed.autoSave} label="评论设置" savedText={props.pendingApplication ? '已自动保存，待应用到网站' : '已自动保存'} />
    <label className="checkbox"><input type="checkbox"
      checked={managed.record!.value.commentModeration !== false}
      onChange={event => managed.setRecord(row => ({ ...row!, value: { ...row!.value, commentModeration: event.target.checked } }))} />新评论需要审核</label>
    <button onClick={async () => {
      try { await managed.autoSave.flush(); await props.publishSettings(); }
      catch (error: any) { props.onError(error.message); }
    }}>发布评论设置</button>
  </details>;
}
