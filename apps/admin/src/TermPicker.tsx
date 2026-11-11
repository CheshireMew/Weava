import { useState, type ReactNode } from 'react';
import type { Term } from '@weava/contracts';
import { api } from './api.ts';
export function termTrail(term: Term, terms: Term[]): string {
  const parent = term.parentId ? terms.find((item) => item.id === term.parentId) : null;
  return parent ? termTrail(parent, terms) + ' › ' + term.label : term.label;
}

export function TermPicker({ label, kind, terms, value, selectedIds, onChange, manage, renderSelection, onAdded }: {
  label: string; kind: Term['kind']; terms: Term[]; value: string[]; selectedIds?: string[];
  onChange: (value: string[], ids: string[]) => void; expanded?: boolean;
  manage?: (query: string) => void;
  renderSelection?: (term: Term, primary: boolean) => ReactNode;
  onAdded?: (term: Term) => void;
}) {
  const [query, setQuery] = useState(''), [added, setAdded] = useState<Term[]>([]), [error, setError] = useState('');
  const catalog = [...terms, ...added.filter((term) => !terms.some((item) => item.id === term.id))].filter((term) => term.kind === kind);
  const ids = (selectedIds ?? value.flatMap((label) => { const term = catalog.find((term) => term.label === label); return term ? [term.id] : []; })).filter(id => catalog.some(term => term.id === id));
  const search = query.trim().toLocaleLowerCase();
  const matching = catalog.filter(term => (!term.archived || ids.includes(term.id)) &&
    (termTrail(term, catalog).toLocaleLowerCase().includes(search) || term.slug.toLocaleLowerCase().includes(search)))
    .sort((a,b) => termTrail(a,catalog).localeCompare(termTrail(b,catalog)));
  const select = (next: string[]) => onChange(next.map((id) => catalog.find((term) => term.id === id)!.label), next);
  const add = async () => {
    const next = query.trim();
    if (!next) return;
    if (manage) { manage(next); return; }
    try {
      const id = 'term-' + crypto.randomUUID();
      const row = await api('terms', { value: { id, kind, label: next, slug: next.replace(/[/?#\\\s]+/g, '-') || id }, revision: null });
      setAdded(rows => [...rows, row.value]);
      onAdded?.(row.value);
      onChange([...value, row.value.label], [...ids, row.id]);
      setQuery(''); setError('');
    } catch(error: any) { setError(error.message); }
  };
  const choices = <>
    <input aria-label={`查找或新建${label}`} placeholder={`搜索或填写新${label}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); const term = matching.find(term => term.label === query.trim()); if (term) { if (!ids.includes(term.id)) select([...ids, term.id]); } else void add(); } }} />
    <div className="term-options">{matching.map(term => <div className="term-option" key={term.id}>
      <label><input type="checkbox" checked={ids.includes(term.id)} onChange={event => select(event.target.checked ? [...ids, term.id] : ids.filter(item => item !== term.id))} />{termTrail(term,catalog)}</label>
      {ids.includes(term.id) && renderSelection?.(term, ids[0] === term.id)}
    </div>)}</div>
    {query.trim() && !catalog.some(term => term.label === query.trim() && !term.archived) && <button type="button" onClick={() => void add()}>添加{label}</button>}{error && <p role="alert">{error}</p>}
    {manage && <button type="button" className="manage-categories-button" onClick={() => manage('')}>管理分类</button>}
    </>;
  return <fieldset className="term-picker"><legend>{label}</legend>
    <div className="term-selection">{ids.map((id) => { const term = catalog.find((term) => term.id === id); return term && <button key={id} type="button" onClick={() => select(ids.filter((item) => item !== id))} aria-label={`移除${label} ${termTrail(term,catalog)}`}>{termTrail(term,catalog)} ×</button>; })}</div>
    <div className="term-choices expanded">{choices}</div>
  </fieldset>;
}
