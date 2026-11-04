import { useEffect, useRef } from 'react';
import type { Revision, Settings, Term } from '@weava/contracts';
import { useManagedRecord } from './EditSessions.tsx';
import { sameEditableValue } from './edit-session.ts';
import { api } from './api.ts';

export interface SiteSettingProps {
  settings: Revision<Settings>;
  saveSettings: (value: Settings, revision: number) => Promise<Revision<Settings>>;
  publishSettings: () => Promise<any>;
  onError: (message: string) => void;
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
  }, label);
  useEffect(() => {
    if (!managed.session.dirty) baseline.current = settings;
    managed.session.receive(settings);
  }, [settings]);
  return managed;
}

export function CommentSettings(props: SiteSettingProps) {
  const managed = useSiteSetting(props, '评论设置', 'commentModeration');
  return <details className="settings-disclosure"><summary>评论设置</summary>
    <label className="checkbox"><input type="checkbox"
      checked={managed.record!.value.commentModeration !== false}
      onChange={event => managed.setRecord(row => ({ ...row!, value: { ...row!.value, commentModeration: event.target.checked } }))} />新评论需要审核</label>
    <button onClick={async () => {
      try { await managed.session.save(); await props.publishSettings(); }
      catch (error: any) { props.onError(error.message); }
    }}>发布评论设置</button>
  </details>;
}

export function CategoryDirectory({ terms, value: selected, onChange }: {
  terms: Term[]; value: Settings['taxonomies']; onChange: (value: Settings['taxonomies']) => void;
}) {
  const categories = terms.filter(term => term.kind === 'category');
  // Older imported directory entries can still be managed before their terms are migrated.
  const available = [...categories, ...selected.filter(item => !categories.some(term => term.id === item.id))];
  return <details className="settings-disclosure"><summary>首页分类目录</summary>
    <div className="category-directory-options">{available.length ? available.map(term => <label className="checkbox" key={term.id}>
      <input type="checkbox" checked={selected.some(item => item.id === term.id)} onChange={event => {
        const taxonomies = event.target.checked ? [...selected, term] : selected.filter(item => item.id !== term.id);
        onChange(taxonomies);
      }} />{term.label}
    </label>) : <p className="muted">创建分类后，可以选择在首页展示的分类。</p>}</div>
  </details>;
}
