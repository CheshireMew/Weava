import { useState } from 'react';
import type { Term } from '@weava/contracts';
import { api } from './api.ts';
export function termTrail(term: Term, terms: Term[]): string {
  const parent = term.parentId ? terms.find((item) => item.id === term.parentId) : null;
  return parent ? termTrail(parent, terms) + ' › ' + term.label : term.label;
}

export function TermPicker({ label, kind, terms, value, selectedIds, onChange }: {
  label: string; kind: Term['kind']; terms: Term[]; value: string[]; selectedIds?: string[]; onChange: (value: string[], ids: string[]) => void;
}) {
  const [query, setQuery] = useState(''), [added, setAdded] = useState<Term[]>([]), [error, setError] = useState('');
  const catalog = [...terms, ...added.filter((term) => !terms.some((item) => item.id === term.id))].filter((term) => term.kind === kind);
  const ids = selectedIds ?? value.flatMap((label) => { const term = catalog.find((term) => term.label === label); return term ? [term.id] : []; });
  const matching = catalog.filter((term) => termTrail(term, catalog).toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => termTrail(a,catalog).localeCompare(termTrail(b,catalog)));
  const select = (next: string[]) => onChange(next.map((id) => catalog.find((term) => term.id === id)!.label), next);
  const add = async () => { const next = query.trim(); if (!next) return; try { const id = 'term-' + crypto.randomUUID(), row = await api('terms', { value: { id, kind, label: next, slug: next.replace(/[/?#\\\s]+/g, '-') || id }, revision: null }); setAdded((rows) => [...rows, row.value]); onChange([...value, row.value.label], [...ids, row.id]); setQuery(''); setError(''); } catch(error: any) { setError(error.message); } };
  return <fieldset className="term-picker"><legend>{label}</legend>
    <div className="term-selection">{ids.map((id) => { const term = catalog.find((term) => term.id === id); return term && <button key={id} type="button" onClick={() => select(ids.filter((item) => item !== id))} aria-label={`移除${label} ${termTrail(term,catalog)}`}>{termTrail(term,catalog)} ×</button>; })}</div>
    <input aria-label={`查找或新建${label}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} />
    <div className="term-options">{matching.map((term) => <label key={term.id}><input type="checkbox" checked={ids.includes(term.id)} onChange={(event) => select(event.target.checked ? [...ids, term.id] : ids.filter((item) => item !== term.id))} />{termTrail(term,catalog)}</label>)}</div>
    {query.trim() && !catalog.some((term) => term.label === query.trim()) && <button type="button" onClick={() => void add()}>添加{label}</button>}{error && <p role="alert">{error}</p>}
  </fieldset>;
}
