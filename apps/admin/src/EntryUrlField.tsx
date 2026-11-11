import {useEffect, useId, useState} from 'react';
import {Languages} from 'lucide-react';
import type {Entry} from '@weava/contracts';
import {englishSlug, entryUrlParts, normalizeSlug} from './entry-url.ts';

export function EntryUrlField({value, onChange}: {value: Entry; onChange: (patch: Partial<Entry>) => void}) {
  const {prefix, slug} = entryUrlParts(value.path, value.id);
  const [text, setText] = useState(slug), [error, setError] = useState('');
  const inputId = useId(), errorId = useId();
  useEffect(() => { setText(slug); setError(''); }, [value.id, value.path]);
  const commit = () => {
    // Opening an imported address never rewrites it, including older non-English URLs.
    if (text === slug) return;
    const candidate = normalizeSlug(text) || value.id.slice(0, 8);
    if (!englishSlug(candidate)) { setError('英文标题请使用英文字母、数字和短横线。'); return; }
    setError(''); setText(candidate);
    const path = prefix + candidate + '/';
    if (path !== value.path) onChange({path});
  };
  return <div className="entry-url-field" data-field-path="path">
    <label htmlFor={inputId}><Languages size={16} aria-hidden="true" />英文标题</label>
    <input id={inputId} value={text} placeholder={value.id.slice(0, 8)} spellCheck={false} autoCapitalize="none" aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
      onChange={event => { setText(event.target.value); setError(''); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); } }} />
    {error && <span className="entry-url-error" id={errorId} role="alert">{error}</span>}
  </div>;
}
