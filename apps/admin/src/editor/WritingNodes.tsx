import {lazy, Suspense, useEffect, useState} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {LinkNode} from '@lexical/link';
import {DecoratorNode, ElementNode, $getRoot, $getNodeByKey, $isElementNode, createCommand, COMMAND_PRIORITY_LOW, type EditorConfig, type LexicalEditor, type LexicalNode, type NodeKey} from 'lexical';
import {Dialog} from '../Dialog.tsx';
import {useSelectors} from '../Selectors.tsx';
import {LoadingState} from '../LoadingState.tsx';
import {createPortal} from 'react-dom';

const Editor = lazy(() => import('../Editor.tsx').then(module => ({default: module.Editor})));
export const EDIT_DETAILS_COMMAND = createCommand<NodeKey>('weava-edit-details');
export function writingDescendants(root: ElementNode = $getRoot()): LexicalNode[] {
  return root.getChildren().flatMap(child => [child, ...($isElementNode(child) ? writingDescendants(child) : [])]);
}

export class DetailsNode extends ElementNode {
  __title: string;
  static getType() {return 'writing-details';}
  $config() {return this.config('writing-details', {extends: ElementNode});}
  static clone(node: DetailsNode) {return new DetailsNode(node.__title, node.__key);}
  constructor(title = '展开补充内容', key?: NodeKey) {super(key); this.__title = title;}
  getTitle() {return this.getLatest().__title;}
  setTitle(title: string) {this.getWritable().__title = title; return this;}
  createDOM(_config: EditorConfig, editor: LexicalEditor) {
    const element = document.createElement('details'); element.className = 'editor-details'; element.open = true;
    const summary = document.createElement('summary'); summary.contentEditable = 'false';
    const label = document.createElement('span'); label.textContent = this.__title;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑'; edit.setAttribute('aria-label', '编辑折叠标题');
    edit.onclick = event => {event.preventDefault(); event.stopPropagation(); editor.dispatchCommand(EDIT_DETAILS_COMMAND, this.getKey());};
    summary.append(label, edit);
    const content = document.createElement('div'); content.className = 'editor-details-content';
    element.append(summary, content); return element;
  }
  getDOMSlot(element: HTMLElement) {return super.getDOMSlot(element).withElement(element.querySelector<HTMLElement>('.editor-details-content')!);}
  updateDOM(previous: DetailsNode, element: HTMLElement) {
    if (previous.__title !== this.__title) element.querySelector('summary > span')!.textContent = this.__title;
    return false;
  }
  static importJSON(value: any) {return new DetailsNode(value.title).updateFromJSON(value);}
  exportJSON(): any {return {...super.exportJSON(), type: 'writing-details', version: 1, title: this.__title};}
  exportDOM() {
    const element = document.createElement('details'); element.className = 'weava-details';
    const summary = document.createElement('summary'); summary.textContent = this.__title; element.append(summary);
    return {element};
  }
  static importDOM(): any {
    return {details: (element: HTMLElement) => ({priority: 3, conversion: () => ({node: new DetailsNode(element.querySelector(':scope > summary')?.textContent ?? '展开补充内容')})}),
      summary: () => ({priority: 3, conversion: () => ({node: null, forChild: () => null})})};
  }
}

export class ButtonLinkNode extends LinkNode {
  static getType() {return 'writing-button';}
  $config() {return this.config('writing-button', {extends: LinkNode});}
  static clone(node: ButtonLinkNode) {return new ButtonLinkNode(node.__url, {target: node.__target, rel: node.__rel, title: node.__title}, node.__key);}
  createDOM(config: EditorConfig) {const element = super.createDOM(config); element.classList.add('weava-link-button'); return element;}
  static importJSON(value: any) {return new ButtonLinkNode(value.url).updateFromJSON(value);}
  exportJSON(): any {return {...super.exportJSON(), type: 'writing-button', version: 1};}
  exportDOM(editor: LexicalEditor) {const result = super.exportDOM(editor); if (result.element instanceof HTMLElement) result.element.classList.add('weava-link-button'); return result;}
  static importDOM(): any {return {a: (element: HTMLAnchorElement) => element.classList.contains('weava-link-button') ? {priority: 3, conversion: () => ({node: new ButtonLinkNode(element.getAttribute('href') ?? '')})} : null};}
}

export class FootnoteNode extends DecoratorNode<any> {
  __label: string;
  __source: string;
  static getType() {return 'writing-footnote';}
  static clone(node: FootnoteNode) {return new FootnoteNode(node.__label, node.__source, node.__key);}
  constructor(label = '', source = '', key?: NodeKey) {super(key); this.__label = label; this.__source = source;}
  isInline() {return true;}
  createDOM() {const element = document.createElement('span'); element.className = 'editor-footnote'; return element;}
  updateDOM() {return false;}
  getLabel() {return this.getLatest().__label;}
  getSource() {return this.getLatest().__source;}
  setSource(source: string) {this.getWritable().__source = source; return this;}
  static importJSON(value: any) {return new FootnoteNode(value.label, value.source).updateFromJSON(value);}
  exportJSON(): any {return {...super.exportJSON(), type: 'writing-footnote', version: 1, label: this.__label, source: this.__source};}
  exportDOM() {const element = document.createElement('span'); element.setAttribute('data-weava-footnote', this.__label); element.setAttribute('data-weava-footnote-source', this.__source); return {element};}
  decorate() {return <FootnoteElement nodeKey={this.__key} label={this.__label} source={this.__source}/>;}
}

function FootnoteElement({nodeKey, label, source}: {nodeKey: NodeKey; label: string; source: string}) {
  const [editor] = useLexicalComposerContext(), selectors = useSelectors();
  const [number, setNumber] = useState(1), [open, setOpen] = useState(false), [draft, setDraft] = useState(source), [error, setError] = useState('');
  useEffect(() => {
    const receive = () => editor.getEditorState().read(() => {
      const labels = [...new Set(writingDescendants().filter(node => node instanceof FootnoteNode).map(node => (node as FootnoteNode).getLabel()))];
      setNumber(labels.indexOf(label) + 1);
    });
    receive(); return editor.registerUpdateListener(receive);
  }, [editor, label]);
  return <><sup><button type="button" aria-label={'编辑脚注 ' + number} onClick={() => {setDraft(source); setError(''); setOpen(true);}}>{number}</button></sup>
    {open && createPortal(<Dialog label="编辑脚注" className="modal writing-insert-dialog" onClose={() => setOpen(false)}>
      <div className="modal-title"><h2>编辑脚注</h2><button type="button" onClick={() => setOpen(false)}>关闭</button></div>
      <Suspense fallback={<LoadingState label="打开脚注"/>}><Editor compact snippets={false} value={{version: 1, format: 'markdown', source: draft}} onChange={value => setDraft(String(value.source))} onMedia={() => selectors.media()} onError={setError}/></Suspense>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="primary" disabled={!draft.trim()} onClick={() => {
        editor.update(() => {for (const node of writingDescendants()) if (node instanceof FootnoteNode && node.getLabel() === label) node.setSource(draft); $getNodeByKey(nodeKey)?.selectNext();}); setOpen(false);
      }}>保存脚注</button></div>
    </Dialog>, document.body)}
  </>;
}

export function WritingNodesPlugin() {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState<{key: NodeKey; title: string} | null>(null);
  useEffect(() => editor.registerCommand(EDIT_DETAILS_COMMAND, key => {
    const node = $getNodeByKey(key); if (!(node instanceof DetailsNode)) return false;
    setEditing({key, title: node.getTitle()}); return true;
  }, COMMAND_PRIORITY_LOW), [editor]);
  return editing && createPortal(<Dialog label="编辑折叠标题" onClose={() => setEditing(null)}>
    <form onSubmit={event => {event.preventDefault(); event.stopPropagation(); editor.update(() => {const node = $getNodeByKey(editing.key); if (node instanceof DetailsNode) node.setTitle(editing.title.trim());}); setEditing(null);}}>
      <h2>编辑折叠标题</h2><label>标题<input data-autofocus required maxLength={160} value={editing.title} onChange={event => setEditing({...editing, title: event.target.value})}/></label>
      <div className="dialog-actions"><button type="button" onClick={() => {editor.update(() => {const node = $getNodeByKey(editing.key); if (node instanceof DetailsNode) {for (const child of node.getChildren()) node.insertBefore(child); node.remove();}}); setEditing(null);}}>取消折叠并保留内容</button><button type="submit" className="primary">保存标题</button></div>
    </form>
  </Dialog>, document.body);
}
