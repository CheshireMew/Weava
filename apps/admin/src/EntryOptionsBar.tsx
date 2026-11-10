import {usePopover} from './usePopover.ts';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Folder,Image,Settings2,SlidersHorizontal,Tags,UserRound,X} from 'lucide-react';
import {TermPicker} from './TermPicker.tsx';
import {EntrySchedule} from './EntrySchedule.tsx';
import {useSelectors} from './Selectors.tsx';
import type {EntrySettingsModel} from './content-models.ts';

type Option = 'author' | 'category' | 'tag' | 'cover' | 'publication';
const labels: Record<Option, string> = { author: '作者', category: '分类', tag: '标签', cover: '封面', publication: '发布选项' };
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="entry-option-toggle"><span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={checked} className="entry-toggle" onClick={() => onChange(!checked)}><span /></button></div>;
}

export function EntryOptionsBar({ model, onMore }: { model: Pick<EntrySettingsModel,'record'|'update'|'state'|'setError'|'schedule'>; onMore: () => void }) {
  const { record, update, state, setError } = model;
  const selectors = useSelectors();
  const [open, setOpen] = useState<Option | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const {position,close,portalTarget}=usePopover({open,trigger,popup,onClose:()=>setOpen(null),align:'start',initialFocus:'input'});
  useEffect(() => { setOpen(null); }, [record?.id]);
  if (!record) return null;
  const value = record.value;
  async function chooseCover() {
    close(true);
    try { const media = await selectors.media('image'); if (media) update({ cover: media.url }); }
    catch (error: any) { setError(error.message); }
  }
  const option = (key: Option, icon: React.ReactNode, summary?: string) => <button type="button" key={key} data-field-path={key === 'author' ? 'author' : undefined} aria-label={'设置' + labels[key]} aria-haspopup="dialog" aria-expanded={open === key} aria-controls={open === key ? popupId : undefined}
    onClick={event => { trigger.current = event.currentTarget; setOpen(current => current === key ? null : key); }}>
    {icon}<span>{labels[key]}</span>{summary && <span className="entry-option-value">{summary}</span>}<ChevronDown size={12} aria-hidden="true" />
  </button>;
  return <>
    <div className="entry-options-bar" role="group" aria-label="文章设置">
      {option('author', <UserRound size={16} aria-hidden="true" />, value.author)}
      {option('category', <Folder size={16} aria-hidden="true" />, value.categories.length ? value.categories[0] + (value.categories.length > 1 ? ` +${value.categories.length - 1}` : '') : undefined)}
      {option('tag', <Tags size={16} aria-hidden="true" />, value.tags.length ? String(value.tags.length) : undefined)}
      {option('cover', <span className="entry-cover-icon">{value.cover ? <img className="entry-cover-thumb" src={value.cover} alt="" /> : <Image size={16} aria-hidden="true" />}</span>)}
      <span className="entry-options-divider" aria-hidden="true" />
      {option('publication', <SlidersHorizontal size={16} aria-hidden="true" />, value.visibility === 'private' ? '私密' : undefined)}
      <button type="button" aria-haspopup="dialog" onClick={() => { close(); onMore(); }}><Settings2 size={16} aria-hidden="true" />更多设置</button>
    </div>
    {open && createPortal(<div ref={popup} id={popupId} className="entry-options-popover" role="dialog" aria-label={labels[open]} style={position}>
      <button type="button" className="entry-option-close" aria-label={'关闭' + labels[open]} onClick={() => close(true)}><X size={16} aria-hidden="true" /></button>
      {open === 'author' && <section><h2>作者</h2><label>作者姓名<input aria-label="作者姓名" value={value.author} placeholder="填写作者" onChange={event => update({ author: event.target.value })} /></label></section>}
      {(open === 'category' || open === 'tag') && <TermPicker key={record.id + open} expanded label={labels[open]} kind={open} terms={(state.terms ?? []).map((row: any) => row.value)} value={open === 'category' ? value.categories : value.tags} selectedIds={open === 'category' ? value.termIds?.categories : value.termIds?.tags}
        onChange={(terms, ids) => update(open === 'category' ? { categories: terms, termIds: { categories: ids, tags: value.termIds?.tags ?? [] } } : { tags: terms, termIds: { tags: ids, categories: value.termIds?.categories ?? [] } })} />}
      {open === 'cover' && <section className="entry-cover-option"><h2>封面</h2>{value.cover && <img src={value.cover} alt="文章封面" />}<div><button type="button" onClick={chooseCover}>{value.cover ? '更换封面' : '选择封面'}</button>{value.cover && <button type="button" onClick={() => { update({ cover: '' }); close(true); }}>移除封面</button>}</div>
        </section>}
      {open === 'publication' && <section className="entry-publication-option"><h2>发布选项</h2>
        <Toggle label="私密文章" checked={value.visibility === 'private'} onChange={checked => update({ visibility: checked ? 'private' : 'public' })} />
        <Toggle label="允许评论" checked={value.allowComments !== false} onChange={checked => update({ allowComments: checked })} />
        <div className="entry-option-schedule"><h3>定时发布</h3><EntrySchedule model={model.schedule} /></div>
      </section>}
    </div>, portalTarget)}
  </>;
}
