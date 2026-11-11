import {useState, type FormEvent} from 'react';
import {Plus, X} from 'lucide-react';
import {isReservedContentPath, type Term} from '@weava/contracts';
import {api} from './api.ts';
import type {ContentState} from './content-models.ts';
import {Dialog} from './Dialog.tsx';
import {englishSlug, normalizeSlug} from './entry-url.ts';
import {termTrail} from './TermPicker.tsx';

type TermRow = ContentState['terms'][number];
type CategoryDraft = { value: Term; revision: number | null };
const blank = (label = ''): CategoryDraft => ({
  revision: null,
  value: { id: 'term-' + crypto.randomUUID(), kind: 'category', label, slug: '' },
});

export function CategoryDialog({rows, initialId, initialLabel, selectAfterSave, onClose, onSaved, refresh}: {
  rows: TermRow[];
  initialId?: string;
  initialLabel?: string;
  selectAfterSave: boolean;
  onClose: () => void;
  onSaved: (row: TermRow, select: boolean) => void;
  refresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<CategoryDraft | null>(() =>
    rows.find(row => row.id === initialId) ?? (initialLabel ? blank(initialLabel) : null));
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const categories = rows.filter(row => row.value.kind === 'category');
  const catalog = categories.map(row => row.value);
  const search = query.trim().toLowerCase();
  const visible = categories.filter(({value}) => termTrail(value, catalog).toLowerCase().includes(search) || value.slug.toLowerCase().includes(search))
    .sort((a, b) => Number(!!a.value.archived) - Number(!!b.value.archived) || a.value.label.localeCompare(b.value.label, 'zh-CN'));
  const canSelect = selectAfterSave && (initialId ? draft?.value.id === initialId : draft?.revision === null);
  function edit(next: CategoryDraft | null) {
    setError('');
    setDraft(next);
  }
  function update(patch: Partial<Term>) {
    setDraft(current => current && { ...current, value: { ...current.value, ...patch } });
    setError('');
  }
  async function save(value: Term, revision: number | null, select = false) {
    setBusy(true);
    setError('');
    try {
      const saved: TermRow = await api('terms', {value, revision});
      onSaved(saved, select);
      setDraft(null);
      void refresh().catch(error => setError('分类已保存，列表刷新失败。' + error.message));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const label = draft.value.label.trim(), slug = normalizeSlug(draft.value.slug);
    if (!label || !englishSlug(slug)) {
      setError(!label ? '请填写分类中文名。' : '英文别名请使用英文字母、数字和短横线。');
      return;
    }
    if (isReservedContentPath('/' + slug + '/article/')) {
      setError('这个英文别名与系统网址冲突。');
      return;
    }
    void save({...draft.value, label, slug}, draft.revision, canSelect);
  }
  const existing = draft && categories.find(row => row.id === draft.value.id);
  return <Dialog label="管理分类" className="modal category-dialog" onClose={onClose} dismissible={!busy}>
    <div className="article-options-heading">
      <h2>管理分类</h2>
      <button type="button" aria-label="关闭分类管理" disabled={busy} onClick={onClose}><X size={18} /></button>
    </div>
    {draft ? <form className="category-form" onSubmit={submit}>
      <label>分类中文名<input key={draft.value.id} data-autofocus={initialId ? undefined : ''} autoFocus={!initialId} required value={draft.value.label} onChange={event => update({label: event.target.value})} /></label>
      <label>英文别名<input data-autofocus={initialId ? '' : undefined} autoFocus={!!initialId} required value={draft.value.slug} placeholder="例如 writing" spellCheck={false} autoCapitalize="none" onChange={event => update({slug: event.target.value})} /></label>
      <div className="category-form-actions">
        {existing && !canSelect && <button type="button" disabled={busy} onClick={() => void save({...existing.value, archived: !existing.value.archived}, existing.revision)}>{existing.value.archived ? '恢复使用' : '停用分类'}</button>}
        <button type="button" disabled={busy} onClick={() => edit(null)}>返回列表</button>
        <button type="submit" className="primary" disabled={busy}>{canSelect ? '保存并选用' : '保存分类'}</button>
      </div>
    </form> : <>
      <div className="category-dialog-tools">
        <input data-autofocus type="search" aria-label="搜索分类" placeholder="搜索分类" value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" onClick={() => edit(blank())}><Plus size={16} />新建分类</button>
      </div>
      <div className="category-dialog-list">
        {visible.map(row => <button type="button" key={row.id} onClick={() => edit(row)}>
          <span>{termTrail(row.value, catalog)}</span>
          <small>{row.value.archived ? '已停用' : englishSlug(row.value.slug) ? '/' + row.value.slug.toLowerCase() + '/' : '待补英文别名'}</small>
        </button>)}
        {!visible.length && <p className="muted">{query ? '没有匹配的分类' : '尚未创建分类'}</p>}
      </div>
    </>}
    {error && <p className="entry-url-error" role="alert">{error}</p>}
  </Dialog>;
}
