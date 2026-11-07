import {useEffect, useRef, type RefObject} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$convertToMarkdownString} from '@lexical/markdown';
import type {EditorState} from 'lexical';
import type {Document} from '@weava/contracts';
import {transformers} from './transformers.tsx';

/** Focus, selection and normalization do not create authored revisions. */
export function DocumentChangePlugin({value, editing, outputFormat, onChange}: {
  value: Document; editing: RefObject<boolean>; outputFormat: 'lexical' | 'markdown'; onChange: (document: Document) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef({value, onChange}); latest.current = {value, onChange};
  useEffect(() => {
    const original = latest.current.value;
    const read = (state: EditorState): Document => outputFormat === 'markdown'
      ? state.read(() => ({version: 1, format: 'markdown', source: $convertToMarkdownString(transformers)}))
      : {version: 1, format: 'lexical', source: state.toJSON() as any};
    let baseline = JSON.stringify(read(editor.getEditorState())), previous = baseline;
    return editor.registerUpdateListener(({editorState, dirtyElements, dirtyLeaves}) => {
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      const next = read(editorState), fingerprint = JSON.stringify(next);
      if (!editing.current) {baseline = fingerprint; previous = fingerprint; return;}
      if (fingerprint === previous) return;
      previous = fingerprint;
      const document = fingerprint === baseline ? original : next;
      if (JSON.stringify(document) !== JSON.stringify(latest.current.value)) latest.current.onChange(document);
    });
  }, [editor, editing, outputFormat]);
  return null;
}
