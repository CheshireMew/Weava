import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$createLinkNode, $isLinkNode, $toggleLink, type LinkNode} from '@lexical/link';
import {$createTextNode, $getNearestNodeFromDOMNode, $getNodeByKey, $getSelection, $insertNodes, $isRangeSelection, $isTextNode, $setSelection, CLICK_COMMAND, COMMAND_PRIORITY_HIGH, createCommand, HISTORY_PUSH_TAG, KEY_MODIFIER_COMMAND, type LexicalNode, type RangeSelection} from 'lexical';
import {api} from '../api.ts';
import {useSelectors} from '../Selectors.tsx';
import {usePopover} from '../usePopover.ts';

export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>('OPEN_LINK_EDITOR');

export function $parentLink(node: LexicalNode | null): LinkNode | null {
  while (node) {if ($isLinkNode(node)) return node; node = node.getParent();}
  return null;
}

interface LinkPopup {
  mode: 'view' | 'edit'; key?: string; href: string; selection: RangeSelection | null;
  context: string;
  anchor: Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right'>;
}

export function LinkEditorPlugin({onEdit, onError, entryId}: {onEdit: () => void; onError: (message: string) => void; entryId?: string}) {
  const [editor] = useLexicalComposerContext(), selectors = useSelectors();
  const [state, setState] = useState<LinkPopup | null>(null), [url, setUrl] = useState('');
  const [resolved, setResolved] = useState<{source: string; path: string} | null>(null), [picking, setPicking] = useState(false);
  const trigger = useRef<HTMLElement | null>(null), popup = useRef<HTMLDivElement>(null);
  const active = useRef(state), dismissed = useRef<string | undefined>(undefined), dirtyUrl = useRef(false);
  active.current = state;
  const close = useCallback(() => {dismissed.current = active.current?.key; setState(null);}, []);
  const {position, portalTarget} = usePopover({open: state && !picking, trigger, popup, onClose: close, align: 'start', initialFocus: state?.mode === 'edit' ? '[data-autofocus]' : false, anchorRect: state?.anchor});

  const show = useCallback((mode: LinkPopup['mode'], explicitNode?: LinkNode) => {
    const selection = $getSelection();
    const range = $isRangeSelection(selection) ? selection.clone() : null;
    const anchorLink = range ? $parentLink(range.anchor.getNode()) : null;
    const focusLink = range ? $parentLink(range.focus.getNode()) : null;
    const node = explicitNode ?? (anchorLink && anchorLink.is(focusLink) ? anchorLink : null);
    const root = editor.getRootElement(); if (!root || !node && !range) return;
    trigger.current = root;
    let bounds = root.getBoundingClientRect();
    if (node) bounds = editor.getElementByKey(node.getKey())?.getBoundingClientRect() ?? bounds;
    else {
      const native = window.getSelection();
      if (native?.rangeCount && root.contains(native.anchorNode)) bounds = native.getRangeAt(0).getBoundingClientRect?.() ?? bounds;
    }
    const href = node?.getURL() ?? '';
    dismissed.current = undefined; dirtyUrl.current = false; setUrl(href);
    const context = (range?.getTextContent() || range?.anchor.getNode().getTopLevelElement()?.getTextContent() || '').trim().slice(0, 500);
    setState({mode, key: node?.getKey(), href, selection: range, context, anchor: {top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right}});
  }, [editor]);

  useEffect(() => {
    const removeOpen = editor.registerCommand(OPEN_LINK_EDITOR_COMMAND, () => {show('edit'); return true;}, COMMAND_PRIORITY_HIGH);
    const removeShortcut = editor.registerCommand(KEY_MODIFIER_COMMAND, event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return false;
      event.preventDefault(); show('edit'); return true;
    }, COMMAND_PRIORITY_HIGH);
    const removeClick = editor.registerCommand(CLICK_COMMAND, event => {
      const element = event.target instanceof Element ? event.target.closest('a') : null;
      if (!element) {if (active.current) close(); return false;}
      if (!element || !editor.getRootElement()?.contains(element) || (event.target as Element).closest('button,figure')) return false;
      const node = $parentLink($getNearestNodeFromDOMNode(element)); if (!node) return false;
      event.preventDefault();
      node.select(); show('view', node); return true;
    }, COMMAND_PRIORITY_HIGH);
    const removeUpdate = editor.registerUpdateListener(({editorState}) => {
      if (active.current?.mode === 'edit' || popup.current?.contains(document.activeElement)) return;
      editorState.read(() => {
        const selection = $getSelection();
        const candidate = $isRangeSelection(selection) ? $parentLink(selection.anchor.getNode()) : null;
        const node = candidate && $isRangeSelection(selection) && candidate.is($parentLink(selection.focus.getNode())) ? candidate : null;
        if (!node) {dismissed.current = undefined; if (active.current) setState(null); return;}
        if (node.getKey() === dismissed.current || active.current?.key === node.getKey() && active.current.href === node.getURL()) return;
        show('view', node);
      });
    });
    return () => {removeOpen(); removeShortcut(); removeClick(); removeUpdate();};
  }, [editor, show, close]);

  useEffect(() => {
    const href = state?.href;
    if (!href?.startsWith('entry:')) {setResolved(null); return;}
    let mounted = true;
    let id: string;
    try {id = decodeURIComponent(href.slice(6));} catch {setResolved({source: href, path: ''}); return;}
    void api(`entry/${encodeURIComponent(id)}`).then(record => {
      if (mounted) setResolved({source: href, path: record.value.path});
    }).catch(() => {if (mounted) setResolved({source: href, path: ''});});
    return () => {mounted = false;};
  }, [state?.href]);
  const address = state?.href.startsWith('entry:') ? resolved?.source === state.href ? resolved.path : null : state?.href;
  useEffect(() => {
    if (state?.mode === 'edit' && state.href.startsWith('entry:') && address && !dirtyUrl.current) setUrl(address);
  }, [state?.mode, state?.href, address]);

  function focusSaved(selection: RangeSelection | null) {
    editor.focus();
    if (selection) editor.update(() => {
      if ($getNodeByKey(selection.anchor.key) && $getNodeByKey(selection.focus.key)) $setSelection(selection.clone());
    });
  }
  function cancel() {
    if (state?.key) {setState({...state, mode: 'view'}); focusSaved(state.selection);}
    else {close(); focusSaved(state?.selection ?? null);}
  }
  function apply(href: string, title = href.trim()) {
    if (!state || !href.trim()) return;
    const saved = state;
    onEdit();
    editor.update(() => {
      const existing = saved.key ? $getNodeByKey(saved.key) : null;
      if ($isLinkNode(existing)) {
        if (saved.selection && $getNodeByKey(saved.selection.anchor.key) && $getNodeByKey(saved.selection.focus.key)) $setSelection(saved.selection.clone());
        existing.setURL(href.trim());
      }
      else if (saved.selection && $getNodeByKey(saved.selection.anchor.key) && $getNodeByKey(saved.selection.focus.key)) {
        $setSelection(saved.selection.clone());
        if (saved.selection.isCollapsed()) $insertNodes([$createLinkNode(href.trim()).append($createTextNode(title))]);
        else $toggleLink(href.trim());
      }
    }, {tag: HISTORY_PUSH_TAG});
    close(); editor.focus();
  }
  function removeLink() {
    if (!state?.key) return;
    const key = state.key; onEdit();
    editor.update(() => {
      const node = $getNodeByKey(key); if (!$isLinkNode(node)) return;
      const first = node.getFirstDescendant();
      for (const child of node.getChildren()) node.insertBefore(child);
      node.remove(); if ($isTextNode(first)) first.select(0, 0);
    }, {tag: HISTORY_PUSH_TAG});
    close(); editor.focus();
  }
  if (!state) return null;
  return createPortal(<div ref={popup} role="dialog" aria-label={state.mode === 'view' ? '链接详情' : state.key ? '修改链接' : '插入链接'} className={'admin-popover editor-link-popover ' + (state.mode === 'edit' ? 'is-editing' : '')} style={position}
    onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); if (state.mode === 'view') {close(); focusSaved(state.selection);} else cancel();}}}>
    {state.mode === 'view' ? <div className="editor-link-preview">
      {address ? <a className="editor-link-destination" href={address} title={address} target="_blank" rel="noopener noreferrer">{address}</a>
        : <span className="editor-link-destination">{address === null ? '正在读取地址…' : '链接内容暂不可用'}</span>}
      <button type="button" aria-label="修改链接" onMouseDown={event => event.preventDefault()} onClick={() => {dirtyUrl.current = false; setUrl(address || state.href); setState({...state, mode: 'edit'});}}>修改</button>
      <button type="button" aria-label="移除链接" onMouseDown={event => event.preventDefault()} onClick={removeLink}>移除</button>
    </div> : <form onSubmit={event => {event.preventDefault(); apply(state.href.startsWith('entry:') && !dirtyUrl.current ? state.href : url);}}>
      <strong>{state.key ? '修改链接' : '插入链接'}</strong>
      <input data-autofocus required aria-label="链接地址" placeholder="https://…" value={state.href.startsWith('entry:') && address === null && !dirtyUrl.current ? '' : url} onChange={event => {dirtyUrl.current = true; setUrl(event.target.value);}}/>
      <div className="editor-link-actions"><button type="button" onClick={() => {
        setPicking(true);
        const selection = entryId ? selectors.contentLink({id: entryId, context: state.context}) : selectors.content();
        void selection.then(content => {if (content) apply('entry:' + encodeURIComponent(content.id), content.title);}).catch(error => onError(error.message)).finally(() => setPicking(false));
      }}>链接到内容</button><button type="button" onClick={cancel}>取消</button><button type="submit" className="primary">{state.key ? '保存' : '插入'}</button></div>
    </form>}
  </div>, portalTarget);
}
