import {usePopover} from './usePopover.ts';
import {useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export function Popover({ label, trigger, children, className = '', menu = false, align = 'end' }: {
  label: string; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); className?: string; menu?: boolean; align?: 'start' | 'end';
}) {
  const [open,setOpen]=useState(false);
  const button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), id = useId();
  const {position,close,menuKeyDown,portalTarget}=usePopover({open,trigger:button,popup,onClose:()=>setOpen(false),align});
  return <>
    <button ref={button} type="button" aria-label={label} aria-haspopup={menu ? 'menu' : 'dialog'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && createPortal(<div ref={popup} id={id} role={menu ? 'menu' : 'dialog'} aria-label={label} className={'admin-popover ' + className} style={position}
      onClick={event => { if (menu && (event.target as Element).closest('button')) close(true); }}
      onKeyDown={event=>{if(menu)menuKeyDown(event);}}>{typeof children === 'function' ? children(() => close(true)) : children}</div>, portalTarget)}
  </>;
}
