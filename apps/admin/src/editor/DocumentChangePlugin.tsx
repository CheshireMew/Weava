import {useEffect, useRef, type RefObject} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import type {EditorState} from 'lexical';
import type {Document} from '@weava/contracts';
import {exportMarkdown} from './transformers.tsx';
import {usePendingEditWork} from '../EditSessions.tsx';

/** Focus, selection and normalization do not create authored revisions. */
export function DocumentChangePlugin({value,seed, editing, outputFormat, onChange,flushSnapshot}: {
  value: Document;seed:Document; editing: RefObject<boolean>; outputFormat: 'lexical' | 'markdown'; onChange: (document: Document) => void;flushSnapshot?:RefObject<()=>void>;
}) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef({value, onChange}); latest.current = {value, onChange};
  const pending=useRef<EditorState|null>(null),flush=useRef(()=>{});
  usePendingEditWork(()=>{if(!pending.current)return null;flush.current();return Promise.resolve();});
  useEffect(() => {
    const original = latest.current.value;
    const read = (state: EditorState): Document => outputFormat === 'markdown'
      ? state.read(() => ({version: 1, format: 'markdown', source: exportMarkdown()}))
      : {version: 1, format: 'lexical', source: state.toJSON() as any};
    let initial=editor.getEditorState(),baseline:Document|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const same=(a:Document,b:Document)=>a===b||a.format===b.format&&(a.format==='lexical'?JSON.stringify(a.source)===JSON.stringify(b.source):a.source===b.source);
    const publish=()=>{
      clearTimeout(timer);timer=undefined;
      const state=pending.current;if(!state)return;pending.current=null;
      baseline??=read(initial);
      const next=read(state),document=same(next,baseline)?original:next;
      if(!same(document,latest.current.value))latest.current.onChange(document);
    };
    flush.current=publish;
    if(flushSnapshot)flushSnapshot.current=publish;
    const remove=editor.registerUpdateListener(({editorState, dirtyElements, dirtyLeaves}) => {
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      if(!editing.current){initial=editorState;baseline=undefined;return;}
      pending.current=editorState;
      // Large typing stays inside Lexical; explicit actions/navigation flush the latest snapshot.
      if(typeof original.source==='string'&&original.source.length>40000&&editor.getRootElement()?.contains(document.activeElement)){
        clearTimeout(timer);timer=setTimeout(publish,150);
      }else publish();
    });
    const root=editor.getRootElement(),hidden=()=>{if(document.visibilityState==='hidden')publish();};
    root?.addEventListener('focusout',publish);window.addEventListener('beforeunload',publish,true);document.addEventListener('visibilitychange',hidden);
    return()=>{remove();publish();root?.removeEventListener('focusout',publish);window.removeEventListener('beforeunload',publish,true);document.removeEventListener('visibilitychange',hidden);};
  }, [editor, editing, outputFormat,seed]);
  return null;
}
