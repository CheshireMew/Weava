import {usePopover} from './usePopover.ts';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,MoreHorizontal,Pencil,Trash2} from 'lucide-react';
import {Dialog} from './Dialog.tsx';
import type {EntryActionsModel} from './content-models.ts';

export function EntryActions({ row, model, disabled }: { row: any; model: EntryActionsModel; disabled: boolean }) {
  const [open, setOpen] = useState(false), [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const title = row.value.title || '无标题';
  const {position,close:closeMenu,menuKeyDown,portalTarget}=usePopover({open,trigger,popup:menu,onClose:()=>setOpen(false),gap:6,initialFocus:'button'});
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  async function duplicate() {
    closeMenu(true);
    setPending(true);
    try { await model.duplicateEntry(row); }
    catch (error: any) { model.setError(error.message); }
    finally { setPending(false); }
  }
  async function remove() {
    setPending(true);
    setError('');
    try { await model.deleteEntry(row); setConfirming(false); }
    catch (error: any) { setError(error.message); }
    finally { setPending(false); }
  }
  return <>
    <button ref={trigger} className="publication-actions-trigger" aria-label={'更多操作：' + title}
      title="更多操作" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled || pending} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <MoreHorizontal size={22} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="publication-actions-menu" role="menu" aria-label={title + '的操作'} style={position}
      onKeyDown={event=>menuKeyDown(event,'[role=menuitem]:not(:disabled)')}
      >
      <button role="menuitem" onClick={() => { closeMenu(true); void model.select(row.id); }}><Pencil size={19} aria-hidden="true" />编辑</button>
      {model.tab!=='notes'&&<button role="menuitem" onClick={duplicate}><Copy size={19} aria-hidden="true" />复制</button>}
      <div className="publication-actions-divider" role="separator" />
      <button role="menuitem" className="publication-delete" onClick={() => { closeMenu(true); setError(''); setConfirming(true); }}><Trash2 size={19} aria-hidden="true" />删除</button>
    </div>, portalTarget)}
    {confirming && <Dialog label="删除内容" className="modal entry-delete-dialog" onClose={() => setConfirming(false)} dismissible={!pending}>
      <h2>删除“{title}”？</h2>
      <p>内容将移入回收站，可以恢复为草稿。已发布内容会同时从网站撤下。</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="entry-delete-actions">
        <button data-autofocus disabled={pending} onClick={() => setConfirming(false)}>取消</button>
        <button className="publication-delete-confirm async-action" disabled={pending} onClick={remove}>{pending ? '正在删除…' : '删除'}</button>
      </div>
    </Dialog>}
  </>;
}
