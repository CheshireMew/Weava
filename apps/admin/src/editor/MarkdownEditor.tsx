import {useLayoutEffect, useRef, useState,lazy,Suspense, type DragEvent, type ClipboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {Dialog} from '../Dialog.tsx';
import {useSelectors, type SelectedMedia} from '../Selectors.tsx';
import {allowFileDrop} from '../file-drop.tsx';
import {FormattingToolbar, ToolbarOutlet, type FormatAction} from './FormattingToolbar.tsx';
import {SnippetsDialog, WritingInsertDialog, type WritingInsert} from './WritingDialogs.tsx';
import {escapeWritingHtml, inlineCode} from '../../../../packages/runtime-common/src/writing-format.ts';
import type {SourceInput} from './SourceCode.tsx';
const SourceCode=lazy(()=>import('./SourceCode.tsx'));

interface Selection {start: number; end: number}
interface Snapshot extends Selection {source: string}
const label = (text: string) => text.replace(/[\\\[\]]/g, '\\$&');
const destination = (text: string) => text.replace(/[\s()]/g, character => encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'));

function fenceAt(source: string, position: number) {
  let opened: {start: number; body: number; marker: string; language: string} | undefined;
  for (const match of source.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm)) {
    if (opened && match[1][0] === opened.marker[0] && match[1].length >= opened.marker.length && !match[2].trim()) {
      if (position >= opened.start && position <= match.index + match[0].length) return {...opened, end: match.index + match[0].length, bodyEnd: match.index};
      opened = undefined;
    } else if (!opened) opened = {start: match.index, body: match.index + match[0].length + 1, marker: match[1], language: match[2].trim() || 'text'};
  }
  return opened && position >= opened.start ? {...opened, end: source.length, bodyEnd: source.length} : undefined;
}

export function MarkdownEditor({source, onChange, onMode, onMedia, onDrop, onPaste, target, compact, snippets, uploading, onError, entryId}: {
  entryId?: string;
  source: string; onChange: (source: string) => void; onMode: () => void;
  onMedia: () => Promise<SelectedMedia | null>; onDrop: (event: DragEvent<HTMLElement>,offset:number) => void;
  onPaste?: (event: ClipboardEvent<HTMLElement>,offset:number) => void;
  target?: HTMLElement | null; compact: boolean; snippets: boolean; uploading: boolean; onError: (message: string) => void;
}) {
  const selectors = useSelectors(), field = useRef<SourceInput|null>(null),large=useRef(source.length>40000).current;
  const current = useRef(source), selection = useRef<Selection>({start: 0, end: 0});
  const pending = useRef<(Selection & {scroll: number}) | null>(null);
  const history = useRef<{undo: Snapshot[]; redo: Snapshot[]}>({undo: [], redo: []});
  const historyRevision=useRef(0);
  const [range, setRange] = useState<Selection>(selection.current);
  const [link, setLink] = useState<{kind: 'link' | 'video'; selection: Selection} | null>(null), [url, setUrl] = useState('');
  const [insert, setInsert] = useState<{kind: WritingInsert | 'snippets'; selection: Selection} | null>(null);
  // An asynchronous upload can replace the source from outside this component.
  // Do not let an older undo snapshot overwrite that external update.
  if (current.current !== source) {current.current = source; history.current = {undo: [], redo: []};historyRevision.current++;}
  useLayoutEffect(() => {
    if (!pending.current || !field.current) return;
    const next = pending.current; pending.current = null;
    field.current.focus({preventScroll: true}); field.current.setSelectionRange(next.start, next.end); field.current.scrollTop = next.scroll;
  });
  const capture = () => {
    const element = field.current;
    return element?{start: element.selectionStart, end: element.selectionEnd}:selection.current;
  };
  function emit(next: Snapshot, focus = true) {
    current.current = next.source; selection.current = {start: next.start, end: next.end};
    if (focus) pending.current = {...selection.current, scroll: field.current?.scrollTop ?? 0};
    onChange(next.source); setRange({...selection.current});
  }
  function commit(next: Snapshot, focus = true) {
    if (!large && next.source !== current.current) {
      history.current.undo.push({source: current.current, ...selection.current});
      if (history.current.undo.length > 100) history.current.undo.shift();
      history.current.redo = [];
    }
    emit(next, focus);
  }
  function replace(text: string, at = capture(), innerStart = 0, innerEnd = text.length) {
    const before = current.current;
    commit({source: before.slice(0, at.start) + text + before.slice(at.end), start: at.start + innerStart, end: at.start + innerEnd});
  }
  function wrap(marker: string) {
    const at = capture(), text = current.current.slice(at.start, at.end);
    if (/\n[ \t]*\n/.test(text)) {
      const paragraphs = text.split(/(\n[ \t]*\n)/);
      const plain = paragraphs.filter((_, index) => index % 2 === 0 && paragraphs[index].trim());
      const remove = plain.every(part => part.trim().startsWith(marker) && part.trim().endsWith(marker));
      return replace(paragraphs.map((part, index) => {
        if (index % 2 || !part.trim()) return part;
        const content = part.trim();
        const next = remove ? content.slice(marker.length, -marker.length) : marker + content + marker;
        return part.slice(0, part.indexOf(content)) + next + part.slice(part.indexOf(content) + content.length);
      }).join(''), at);
    }
    if (text.startsWith(marker) && text.endsWith(marker) && text.length >= marker.length * 2) return replace(text.slice(marker.length, -marker.length), at);
    if (current.current.slice(at.start - marker.length, at.start) === marker && current.current.slice(at.end, at.end + marker.length) === marker)
      return replace(text, {start: at.start - marker.length, end: at.end + marker.length});
    const content = text.trim() || '文字', leading = text.match(/^\s*/)?.[0] ?? '', trailing = text.trim() ? text.match(/\s*$/)?.[0] ?? '' : '';
    replace(leading + marker + content + marker + trailing, at, leading.length + marker.length, leading.length + marker.length + content.length);
  }
  function block(type: string) {
    field.current?.flush?.();
    const at = capture(), value = current.current;
    if (type === 'code') {
      const existing = fenceAt(value, at.start);
      if (existing) return replace(value.slice(existing.body, existing.bodyEnd).replace(/\n$/, ''), {start: existing.start, end: existing.end});
      const content = value.slice(at.start, at.end) || '代码', marker = '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1)));
      const prefix = (at.start && value[at.start - 1] !== '\n' ? '\n\n' : '') + marker + 'text\n';
      return replace(prefix + content + '\n' + marker + (at.end < value.length && value[at.end] !== '\n' ? '\n\n' : ''), at, prefix.length, prefix.length + content.length);
    }
    const start = at.start === 0 ? 0 : value.lastIndexOf('\n', at.start - 1) + 1;
    const last = at.end > at.start && value[at.end - 1] === '\n' ? at.end - 1 : at.end;
    const nextLine = value.indexOf('\n', last), end = nextLine < 0 ? value.length : nextLine;
    const lines = value.slice(start, end).split('\n');
    const prefix = /^h[1-6]$/.test(type) ? '#'.repeat(Number(type.slice(1))) + ' ' : type === 'quote' ? '> ' : type === 'bullet' ? '- ' : '';
    const already = type !== 'paragraph' && lines.every(line => !line.trim() || (type === 'ordered' ? /^\d+\. /.test(line) : line.startsWith(prefix)));
    const result = lines.map((line, index) => {
      const content = line.replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '');
      return !content.trim() ? content : already || type === 'paragraph' ? content : (type === 'ordered' ? (index + 1) + '. ' : prefix) + content;
    }).join('\n');
    replace(result, {start, end});
  }
  function insertBlock(text: string, at = capture()) {
    const value = current.current;
    const before = at.start && !value.slice(0, at.start).endsWith('\n\n') ? (value[at.start - 1] === '\n' ? '\n' : '\n\n') : '';
    const after = at.end < value.length && !value.slice(at.end).startsWith('\n\n') ? (value[at.end] === '\n' ? '\n' : '\n\n') : '';
    replace(before + text + after, at, before.length, before.length + text.length);
  }
  function wrapHtml(tag: string, className?: string) {
    const at = capture(), selected = current.current.slice(at.start, at.end) || '文字';
    replace(selected.split(/(\n[ \t]*\n)/).map((part, index) => {
      if (index % 2 || !part.trim()) return part;
      const content = part.trim(), prefix = part.slice(0, part.indexOf(content)), suffix = part.slice(part.indexOf(content) + content.length);
      return prefix + `<${tag}${className ? ' class="' + className + '"' : ''}>${content}</${tag}>` + suffix;
    }).join(''), at);
  }
  function action(command: FormatAction) {
    field.current?.flush?.();
    selection.current = capture();
    if (command === 'undo' || command === 'redo') {
      if (large) {field.current?.[command]?.(); return;}
      const from = history.current[command], next = from.pop(); if (!next) return;
      history.current[command === 'undo' ? 'redo' : 'undo'].push({source: current.current, ...capture()}); emit(next);
    } else if (command === 'bold' || command === 'italic') wrap(command === 'bold' ? '**' : '*');
    else if (command === 'strikethrough') wrap('~~');
    else if (command === 'inline-code') {const at = capture(); replace((current.current.slice(at.start, at.end) || '代码').split('\n').map(line => line ? inlineCode(line) : '').join('\n'), at);}
    else if (['underline','superscript','subscript'].includes(command)) {
      const tag = {underline: 'u', superscript: 'sup', subscript: 'sub'}[command as 'underline'];
      wrapHtml(tag);
    }
    else if (command.startsWith('color:') || command.startsWith('highlight:')) {
      const at = capture(), text = current.current.slice(at.start, at.end) || '文字', [kind, value] = command.split(':');
      if (value === 'none') replace(text.replace(kind === 'color' ? /<span class="weava-color-[^"]*">([\s\S]*?)<\/span>/g : /<mark(?: class="weava-highlight-[^"]*")?>([\s\S]*?)<\/mark>/g, '$1'), at);
      else wrapHtml(kind === 'color' ? 'span' : 'mark', `weava-${kind}-${value}`);
    }
    else if (command.startsWith('align:')) {const alignment = command.slice(6), at = capture(), text = current.current.slice(at.start, at.end) || '正文'; insertBlock(alignment === 'left' ? text.replace(/^<div class="weava-align-[^"]*">\s*([\s\S]*?)\s*<\/div>$/, '$1') : `<div class="weava-align-${alignment}">\n\n${text}\n\n</div>`, at);}
    else if (['quote','bullet','ordered','code'].includes(command)) block(command);
    else if (command === 'link' || command === 'video') {setUrl(''); setLink({kind: command, selection: capture()});}
    else if (command === 'table') insertBlock('| 标题 | 标题 | 标题 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |');
    else if (command === 'divider') insertBlock('---');
    else if (['button','footnote','details','snippets'].includes(command)) setInsert({kind: command as WritingInsert | 'snippets', selection: capture()});
    else if (command === 'media') {
      const at = capture();
      void onMedia().then(media => {if (!media) return;
        const text = media.kind === 'video' || media.kind === 'audio' ? `<figure><${media.kind} src="${escapeWritingHtml(media.url)}" controls preload="metadata"></${media.kind}>${media.caption ? '<figcaption>' + escapeWritingHtml(media.caption) + '</figcaption>' : ''}</figure>` : (media.kind === 'image' ? '!' : '') + '[' + label(media.alt || media.name || '下载附件') + '](' + destination(media.url) + ')' + (media.caption ? '\n\n' + media.caption : '');
        insertBlock(text, at);
      }).catch(error => onError(error.message));
    }
  }
  const fence = fenceAt(source, range.start);
  const line = source.slice(range.start === 0 ? 0 : source.lastIndexOf('\n', range.start - 1) + 1, range.start);
  const blockType = fence ? 'code' : /^#{1,6} /.test(line) ? 'h' + /^#+/.exec(line)![0].length : /^>/.test(line) ? 'quote' : 'paragraph';
  function insertLink(address: string, title = '链接文字') {
    if (!link || !address.trim()) return;
    const text = current.current.slice(link.selection.start, link.selection.end) || (link.kind === 'video' ? '视频' : title);
    if (link.kind === 'video') insertBlock(`<figure><video src="${escapeWritingHtml(address.trim())}" controls preload="metadata"></video></figure>`, link.selection);
    else {const prefix = '[' + label(text) + '](', result = prefix + destination(address.trim()) + ')'; replace(result, link.selection, 1, 1 + label(text).length);} setLink(null);
  }
  return <>
    <ToolbarOutlet target={target}><FormattingToolbar mode="source" onMode={()=>{field.current?.flush?.();onMode();}} compact={compact} snippets={snippets} uploading={uploading} onAction={action}
      blockType={blockType} onBlock={block} codeLanguage={fence?.language ?? 'text'} onLanguage={language => {
        field.current?.flush?.();
        const at=capture(),value=current.current,active=fenceAt(value,at.start);if(!active)return;
        const prefix = active.marker + language + '\n', difference = prefix.length - (active.body - active.start);
        commit({source:value.slice(0,active.start)+prefix+value.slice(active.body),start:Math.max(active.start+prefix.length,at.start+difference),end:Math.max(active.start+prefix.length,at.end+difference)});
      }}/></ToolbarOutlet>
    <div onKeyDownCapture={event=>{
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key=event.key.toLowerCase(),command=key==='b'?'bold':key==='i'?'italic':key==='k'?'link':key==='z'?(event.shiftKey?'redo':'undo'):key==='y'?'redo':undefined;
      if(command){event.preventDefault();event.stopPropagation();action(command);}
    }}>
    {large?<Suspense fallback={<p role="status">正在打开源码…</p>}><SourceCode ref={field} source={source} historyRevision={historyRevision.current} onInput={(source,start,end)=>commit({source,start,end},false)} onSelection={(start,end)=>{selection.current={start,end};setRange({start,end});}} onDrop={onDrop} onPaste={onPaste}/></Suspense>:<textarea ref={element=>{field.current=element;}} className="markdown-editor" aria-label="正文源码" value={source} spellCheck={false}
      onBeforeInput={() => {selection.current = capture();}}
      onSelect={() => {selection.current = capture(); setRange({...selection.current});}}
      onChange={event => commit({source: event.target.value, ...capture()}, false)}
      onDragOver={allowFileDrop} onDrop={event=>onDrop(event,event.currentTarget.selectionStart)} onPaste={event=>onPaste?.(event,event.currentTarget.selectionStart)}/>}</div>
    {link && createPortal(<Dialog label={link.kind === 'video' ? '插入视频' : '插入链接'} onClose={() => setLink(null)}>
      <form onSubmit={event => {event.preventDefault(); insertLink(url);}}><h2>{link.kind === 'video' ? '插入视频' : '插入链接'}</h2>
        <label>网址<input data-autofocus aria-label="链接地址" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" required/></label>
        <div className="dialog-actions">{link.kind === 'link' && <button type="button" onClick={() => {
          const { start, end } = link.selection, markdown = current.current;
          const context = markdown.slice(start, end) || markdown.slice(Math.max(0, start - 180), start + 180);
          const selection = entryId ? selectors.contentLink({ id: entryId, context: context.trim().slice(0, 500) }) : selectors.content();
          void selection.then(content => {if (content) insertLink('entry:' + encodeURIComponent(content.id), content.title);}).catch(error => onError(error.message));
        }}>链接到内容</button>}
          <button type="button" onClick={() => setLink(null)}>取消</button><button type="submit" className="primary">{link.kind === 'video' ? '插入视频' : '插入链接'}</button></div>
      </form>
    </Dialog>, document.body)}
    {insert?.kind === 'snippets' && <SnippetsDialog onClose={() => setInsert(null)} onInsert={value => insertBlock(value, insert.selection)}/>}
    {insert && insert.kind !== 'snippets' && <WritingInsertDialog kind={insert.kind} selected={source.slice(insert.selection.start, insert.selection.end)} onClose={() => setInsert(null)} onInsert={value => {
      const at = insert.selection;
      if (insert.kind === 'button') replace(`<a class="weava-link-button" href="${escapeWritingHtml(value.url)}">${escapeWritingHtml(value.title)}</a>`, at);
      else if (insert.kind === 'details') insertBlock(`<details class="weava-details"><summary>${escapeWritingHtml(value.title)}</summary>\n\n${current.current.slice(at.start, at.end) || '补充内容'}\n\n</details>`, at);
      else {const label = 'note-' + crypto.randomUUID().slice(0, 8), ref = `[^${label}]`, body = current.current; commit({source: body.slice(0, at.start) + ref + body.slice(at.end) + `\n\n[^${label}]: ` + value.source.split('\n').join('\n    '), start: at.start + ref.length, end: at.start + ref.length});}
      setInsert(null);
    }}/>}
  </>;
}
