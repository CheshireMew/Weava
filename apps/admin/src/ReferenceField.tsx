import { useEffect, useState } from 'react';
import { useSelectors } from './Selectors.tsx';
import { api } from './api.ts';
export function ReferenceField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectors = useSelectors(), [title, setTitle] = useState('');
  useEffect(() => { let active = true; if (value) api('entry/' + encodeURIComponent(value)).then((row) => { if (active) setTitle(row.value.title); }).catch(() => { if (active) setTitle('关联内容不可用'); }); else setTitle(''); return () => { active = false; }; }, [value]);
  return <span className="selector-field"><span>{title || '尚未选择'}</span><button type="button" onClick={async () => { const content = await selectors.content(); if (content) onChange(content.id); }}>选择内容</button>{value && <button type="button" onClick={() => onChange('')}>清除</button>}</span>;
}
