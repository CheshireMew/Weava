import {usePopover} from './usePopover.ts';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,Folder,Image,Settings2,SlidersHorizontal,Tags,UserRound,X} from 'lucide-react';
import type {Term} from '@weava/contracts';
import {TermPicker} from './TermPicker.tsx';
import {EntrySchedule} from './EntrySchedule.tsx';
import {useSelectors} from './Selectors.tsx';
import type {ContentState,EntrySettingsModel} from './content-models.ts';
import {CategoryDialog} from './CategoryDialog.tsx';
import {categoryPath,englishSlug,entryUrlParts} from './entry-url.ts';
import {rememberAuthor,rememberedAuthors} from './author-preference.ts';

type Option = 'author' | 'category' | 'tag' | 'cover' | 'publication';
const labels: Record<Option, string> = { author: '作者', category: '分类', tag: '标签', cover: '封面', publication: '发布选项' };
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="entry-option-toggle"><span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={checked} className="entry-toggle" onClick={() => onChange(!checked)}><span /></button></div>;
}

type CategoryRequest = { id?: string; label?: string; selectIds?: string[] };
type TermRow = ContentState['terms'][number];

export function EntryOptionsBar({ model, placement, onMore }: { model: EntrySettingsModel; placement: 'metadata' | 'toolbar'; onMore?: () => void }) {
  const { record, update, state, setError } = model;
  const selectors = useSelectors();
  const [open, setOpen] = useState<Option | null>(null);
  const [categoryRequest, setCategoryRequest] = useState<CategoryRequest | null>(null);
  const [savedTerms, setSavedTerms] = useState<TermRow[]>([]);
  const categoryButton = useRef<HTMLButtonElement>(null);
  const pendingAuthor = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const {position,close,portalTarget}=usePopover({open,trigger,popup,onClose:()=>setOpen(null),align:'start',initialFocus:'input'});
  useEffect(() => { setOpen(null); }, [record?.id]);
  useEffect(() => {
    if (open !== 'author') return;
    return () => {
      if (pendingAuthor.current !== null) rememberAuthor(pendingAuthor.current);
      pendingAuthor.current = null;
    };
  }, [open]);
  if (!record) return null;
  const value = record.value;
  const metadata = placement === 'metadata';
  const catalog = new Map(state.terms.map(row => [row.id, row]));
  for (const saved of savedTerms) {
    if ((catalog.get(saved.id)?.revision ?? 0) < saved.revision) catalog.set(saved.id, saved);
  }
  const rows = [...catalog.values()];
  const terms = rows.map(row => row.value);
  const categoryIds = value.termIds?.categories ?? value.categories.flatMap(label => {
    const term = terms.find(item => item.kind === 'category' && item.label === label);
    return term ? [term.id] : [];
  });
  const category = terms.find(term => term.id === categoryIds[0]);
  const fallback = state.types?.find(row => row.id === value.type)?.value.pathPrefix ?? '/posts/';
  const authors = [...new Set([...rememberedAuthors(), ...(state.authors ?? [])])];
  const manage = (request: CategoryRequest) => { close(true); setCategoryRequest(request); };
  const closeCategories = () => {
    setCategoryRequest(null);
    categoryButton.current?.focus();
  };
  function chooseCategories(ids: string[], catalog: Term[] = terms, forcePath = false) {
    const selected = ids.flatMap(id => catalog.filter(term => term.id === id && term.kind === 'category'));
    const primaryChanged = ids[0] !== categoryIds[0] || forcePath;
    if (primaryChanged && selected[0] && !englishSlug(selected[0].slug)) {
      manage({id: selected[0].id, selectIds: ids});
      return;
    }
    update({
      categories: selected.map(term => term.label),
      termIds: { categories: selected.map(term => term.id), tags: value.termIds?.tags ?? [] },
      ...(primaryChanged ? { path: categoryPath(value, selected, fallback) } : {}),
    });
  }
  function receiveCategory(saved: TermRow, select: boolean) {
    setSavedTerms(old => [...old.filter(row => row.id !== saved.id), saved]);
    if (!select) return;
    const ids = categoryRequest?.selectIds ?? [...new Set([...categoryIds, saved.id])];
    const catalog = [...terms.filter(term => term.id !== saved.id), saved.value];
    chooseCategories(ids, catalog, !!categoryRequest?.selectIds);
    closeCategories();
  }
  async function chooseCover() {
    close(true);
    try { const media = await selectors.media('image'); if (media) update({ cover: media.url }); }
    catch (error: any) { setError(error.message); }
  }
  const option = (key: Option, icon: React.ReactNode, summary?: string) => <button type="button" key={key} ref={key === 'category' ? categoryButton : undefined} data-field-path={key === 'author' ? 'author' : undefined} aria-label={'设置' + labels[key]} aria-haspopup="dialog" aria-expanded={open === key} aria-controls={open === key ? popupId : undefined}
    onClick={event => { trigger.current = event.currentTarget; setOpen(current => current === key ? null : key); }}>
    {icon}<span>{labels[key]}</span>{summary && <span className="entry-option-value">{summary}</span>}<ChevronDown size={12} aria-hidden="true" />
  </button>;
  return <>
    {metadata ? <div className="entry-options-bar entry-metadata" role="group" aria-label="文章信息">
      {option('author', <UserRound size={16} aria-hidden="true" />, value.author)}
      {option('category', <Folder size={16} aria-hidden="true" />, value.categories.length ? (category?.label ?? value.categories[0]) + (value.categories.length > 1 ? ` +${value.categories.length - 1}` : '') : undefined)}
      {option('tag', <Tags size={16} aria-hidden="true" />, value.tags.length ? String(value.tags.length) : undefined)}
    </div> : <div className="entry-options-bar entry-toolbar-options" role="group" aria-label="文章设置">
      {option('cover', <span className="entry-cover-icon">{value.cover ? <img className="entry-cover-thumb" src={value.cover} alt="" /> : <Image size={16} aria-hidden="true" />}</span>)}
      {option('publication', <SlidersHorizontal size={16} aria-hidden="true" />, value.visibility === 'private' ? '私密' : undefined)}
      <button type="button" aria-haspopup="dialog" onClick={() => { close(); onMore?.(); }}><Settings2 size={16} aria-hidden="true" />更多设置</button>
    </div>}
    {open && createPortal(<div ref={popup} id={popupId} className="entry-options-popover" role="dialog" aria-label={labels[open]} style={position}>
      <button type="button" className="entry-option-close" aria-label={'关闭' + labels[open]} onClick={() => close(true)}><X size={16} aria-hidden="true" /></button>
      {open === 'author' && <section><h2>作者</h2>
        <label>作者姓名<input aria-label="作者姓名" value={value.author} placeholder="填写作者" onChange={event => {
          pendingAuthor.current = event.target.value;
          update({author: event.target.value});
        }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); close(true); } }} /></label>
        {authors.length > 0 && <div className="entry-author-list">{authors.map(name =>
          <button key={name} type="button" onClick={() => { pendingAuthor.current = name; update({author: name}); close(true); }}>
            {name}{value.author === name && <Check size={14} aria-hidden="true" />}
          </button>)}</div>}
      </section>}
      {open === 'category' && <TermPicker label="分类" kind="category" terms={terms} value={value.categories} selectedIds={categoryIds}
        onChange={(_, ids) => chooseCategories(ids)} manage={label => manage({label})}
        renderSelection={(term, primary) => {
          if (primary && entryUrlParts(value.path, value.id).prefix === '/' + term.slug.toLowerCase() + '/') return <small>网址分类</small>;
          if (term.archived) return null;
          return <button type="button" className="category-primary-button" onClick={() => chooseCategories([term.id, ...categoryIds.filter(id => id !== term.id)], terms, true)}>用作网址</button>;
        }} />}
      {open === 'tag' && <TermPicker label="标签" kind="tag" terms={terms} value={value.tags} selectedIds={value.termIds?.tags}
        onChange={(tags, ids) => update({tags, termIds: {tags: ids, categories: categoryIds}})}
        onAdded={() => { void model.refresh().catch(error => setError(error.message)); }} />}
      {open === 'cover' && <section className="entry-cover-option"><h2>封面</h2>{value.cover && <img src={value.cover} alt="文章封面" />}<div><button type="button" onClick={chooseCover}>{value.cover ? '更换封面' : '选择封面'}</button>{value.cover && <button type="button" onClick={() => { update({ cover: '' }); close(true); }}>移除封面</button>}</div>
        </section>}
      {open === 'publication' && <section className="entry-publication-option"><h2>发布选项</h2>
        <Toggle label="私密文章" checked={value.visibility === 'private'} onChange={checked => update({ visibility: checked ? 'private' : 'public' })} />
        <Toggle label="允许评论" checked={value.allowComments !== false} onChange={checked => update({ allowComments: checked })} />
        <div className="entry-option-schedule"><h3>定时发布</h3><EntrySchedule model={model.schedule} /></div>
      </section>}
    </div>, portalTarget)}
    {categoryRequest && <CategoryDialog rows={rows} initialId={categoryRequest.id} initialLabel={categoryRequest.label}
      selectAfterSave={!!categoryRequest.selectIds || !!categoryRequest.label} onClose={closeCategories}
      onSaved={receiveCategory} refresh={model.refresh} />}
  </>;
}
