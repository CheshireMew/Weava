// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Editor } from '../apps/admin/src/Editor.tsx';
import { importedDocument } from '../packages/core/src/imported-document.ts';
import {renderDocument} from '../packages/core/src/documents.ts';
import {load} from 'cheerio';
import {markdownFormats} from './fixtures/markdown.ts';
import {api} from '../apps/admin/src/api.ts';
import {$getRoot,$isTextNode} from 'lexical';
import {EditorView} from '@codemirror/view';

vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => null }) }));
vi.mock('../apps/admin/src/api.ts', () => ({api: vi.fn(async () => ({value: {path: '/guide/target/', title: '目标文章'}}))}));
let host: HTMLDivElement, toolbarHost: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); toolbarHost = document.createElement('div'); document.body.append(toolbarHost, host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); toolbarHost.remove(); });
async function clickFormat(name: string) {
  const label = name === '代码' ? '代码块' : name;
  if (!document.querySelector(`[aria-label="${label}"]`)) await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="插入内容"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', {bubbles: true}));});
}

it('loads large Markdown in complete blocks and flushes the last pending edit before changing modes',async()=>{
 const source=('这一段保留原始内容和完整段落。'.repeat(4)+'\n\n').repeat(1024)+'结束[^ref]\n\n[^ref]: **完整脚注**',changed=vi.fn(),error=vi.fn();
 function Harness(){const[value,setValue]=useState({version:1 as const,format:'markdown' as const,source});return <Editor value={value} onChange={next=>{changed(next);setValue(next as any);}} onMedia={async()=>null} onError={error}/>;}
 await act(async()=>root.render(<Harness/>));
 for(let i=0;i<100&&host.querySelector('[aria-busy="true"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
 expect(host.querySelector('[aria-busy="true"]')).toBeNull();expect(changed).not.toHaveBeenCalled();
 const editable=host.querySelector<HTMLElement>('.visual-editor')!,editor=(editable as any).__lexicalEditor;
 expect(editable.querySelectorAll('p').length).toBe(1025);
 await act(async()=>{editable.focus();editable.dispatchEvent(new InputEvent('input',{bubbles:true}));editor.update(()=>{const text=$getRoot().getFirstDescendant();if($isTextNode(text))text.setTextContent('最后输入'+text.getTextContent());},{discrete:true});});
 await clickFormat('切换为 Markdown');
 for(let i=0;i<50&&!host.querySelector('.cm-content');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
 const field=host.querySelector<HTMLElement>('[aria-label="正文源码"]')!,code=EditorView.findFromDOM(field)!;
 expect(code.state.doc.toString().includes('最后输入')).toBe(true);expect(code.state.doc.toString().includes('[^ref]: **完整脚注**')).toBe(true);expect(error).not.toHaveBeenCalled();
 await clickFormat('切换为富文本');expect(host.querySelector('.visual-editor')).toBe(editable);
 await clickFormat('切换为 Markdown');const latest=EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
 await act(async()=>latest.dispatch({changes:{from:latest.state.doc.length,insert:'\n\n后来补充'}}));
 await clickFormat('撤销');expect(latest.state.doc.toString().includes('后来补充')).toBe(false);await clickFormat('重做');
 await clickFormat('切换为富文本');
 for(let i=0;i<100&&host.querySelector('[aria-busy="true"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
 expect(host.querySelector('.visual-editor')?.textContent?.includes('后来补充')).toBe(true);expect(error).not.toHaveBeenCalled();
});

it('applies a palette format at the rich-text selection after its menu takes focus', async () => {
  let saved: any; const error = vi.fn();
  function Harness() {const [value, setValue] = useState({version: 1 as const, format: 'markdown' as const, source: '第一段保留文字。\n\n第二段。'}); return <Editor value={value} onChange={next => {saved = next; setValue(next as any);}} onMedia={async () => null} onError={error}/>;}
  await act(async () => root.render(<Harness/>));
  const editable = host.querySelector('.visual-editor')!;
  await act(async () => {const text = document.createTreeWalker(editable.querySelector('p')!, NodeFilter.SHOW_TEXT).nextNode()!, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 3); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));});
  const menu = host.querySelector<HTMLButtonElement>('[aria-label="更多格式"]')!;
  await act(async () => {menu.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); menu.click();});
  expect(saved).toBeUndefined();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="高亮：黄色"]')!.click());
  const $ = load(renderDocument(saved), null, false); expect($('mark.weava-highlight-yellow').text()).toBe('第一段'); expect($('p').last().text()).toBe('第二段。');
  await clickFormat('切换为 Markdown'); await clickFormat('切换为富文本');
  expect(host.querySelector('.editor-highlight')?.textContent).toBe('第一段'); expect(error).not.toHaveBeenCalled();
});

it('inserts a link button, rich footnote and collapsible content from Markdown dialogs and reopens them visually', async () => {
  let saved: any; const error = vi.fn();
  function Harness() {const [value, setValue] = useState({version: 1 as const, format: 'markdown' as const, source: '正文'}); return <Editor value={value} onChange={next => {saved = next; setValue(next as any);}} onMedia={async () => null} onError={error}/>;}
  await act(async () => root.render(<Harness/>)); await clickFormat('切换为 Markdown');
  const field = host.querySelector<HTMLTextAreaElement>('[aria-label="正文源码"]')!;
  field.setSelectionRange(0, 2); await clickFormat('链接按钮');
  const fields = document.querySelectorAll<HTMLInputElement>('dialog input'); await input(fields[1], 'https://example.com/read');
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
  field.setSelectionRange(field.value.length, field.value.length); await clickFormat('脚注');
  await act(async () => document.querySelector<HTMLButtonElement>('dialog [aria-label="切换为 Markdown"]')!.click());
  await input(document.querySelector<HTMLTextAreaElement>('dialog textarea')!, '**来源说明**');
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
  const end = field.value.indexOf('\n\n[^note-'); field.setSelectionRange(0, end); await clickFormat('折叠内容');
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
  await clickFormat('切换为富文本');
  expect(host.querySelector('.editor-details a.weava-link-button')?.textContent).toBe('正文'); expect(host.querySelector('[aria-label="编辑脚注 1"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑脚注 1"]')!.click());
  expect(document.querySelector('dialog .editor-bold')?.textContent).toBe('来源说明');
  await act(async () => document.querySelector<HTMLButtonElement>('dialog [aria-label="切换为 Markdown"]')!.click());
  await input(document.querySelector<HTMLTextAreaElement>('dialog textarea')!, '**更新来源**');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '保存脚注')!.click());
  expect(renderDocument(saved)).toContain('更新来源'); expect(error).not.toHaveBeenCalled();
});

it('inserts an independent copy of a saved common-content snippet at the selected position', async () => {
  vi.mocked(api as any).mockResolvedValueOnce([{id: 'signature', revision: 1, value: {id: 'signature', name: '签名', source: '**作者签名**\n\n---', archived: false}}]);
  let saved: any;
  function Harness() {const [value, setValue] = useState({version: 1 as const, format: 'markdown' as const, source: '前文\n\n后文'}); return <Editor value={value} onChange={next => {saved = next; setValue(next as any);}} onMedia={async () => null} onError={vi.fn()}/>;}
  await act(async () => root.render(<Harness/>)); await clickFormat('切换为 Markdown'); const field = host.querySelector('textarea')!; field.setSelectionRange(4, 4);
  await clickFormat('常用内容'); expect(document.querySelector('dialog')?.textContent).toContain('签名');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '插入')!.click());
  expect(saved.source).toContain('**作者签名**'); expect(saved.source.indexOf('作者签名')).toBeGreaterThan(saved.source.indexOf('前文')); expect(saved.source.indexOf('作者签名')).toBeLessThan(saved.source.indexOf('后文')); expect(document.querySelector('dialog')).toBeNull();
});

it('opens supported Markdown visually by default without changing its stored content', async () => {
  const changed = vi.fn();
  await act(async () => root.render(<Editor value={{ version: 1, format: 'markdown', source: '一段**加粗**的正文。' }} onChange={changed} onMedia={async () => null} onError={vi.fn()} />));
  expect(host.querySelector('[aria-label="正文编辑器"] strong')?.textContent).toBe('加粗');
  expect(host.querySelector('[aria-label="段落格式"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="代码语言"]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('opens legacy HTML as editable content without exposing source or rewriting it on open', async () => {
  const changed = vi.fn(), error = vi.fn();
  const source = '<section><custom-content>原始内容</custom-content></section>';
  await act(async () => root.render(<Editor value={{ version: 1, format: 'html', source }} onChange={changed} onMedia={async () => null} onError={error} />));
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('iframe')?.title).toBe('正文编辑器');
  expect(host.querySelector('iframe')?.srcdoc).toContain('原始内容');
  expect(error).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it('edits converted articles with lists, tables, media, separators and embeds', async () => {
  const changed = vi.fn();
  const value = importedDocument('<p>正文<strong>加粗</strong></p><h2 id="old-anchor">原标题</h2><ol start="4"><li>第四项</li></ol><hr><table><tr><th>名称</th><td>内容</td></tr></table><a href="/original/"><img src="/media/a.png" alt="原图"></a><iframe src="about:blank" title="视频"></iframe>');
  await act(async () => root.render(<Editor outputFormat="lexical" value={value} onChange={changed} onMedia={async () => null} onError={error => { throw new Error(error); }} />));
  expect(host.querySelector('[aria-label="正文编辑器"] strong')?.textContent).toBe('加粗');
  expect(host.querySelector('ol')?.start).toBe(4);
  expect(host.querySelector('table')?.textContent).toContain('名称');
  expect(host.querySelector('hr')).not.toBeNull();
  expect(host.querySelector('.editor-embed')?.getAttribute('src')).toBe('about:blank');
  expect(host.querySelector('img')?.alt).toBe('原图');
  expect(changed).not.toHaveBeenCalled();
  const editable = host.querySelector('[aria-label="正文编辑器"]') as HTMLElement;
  await act(async () => {
    editable.focus(); const range = document.createRange(); range.selectNodeContents(editable.querySelector('p')!); range.collapse(true);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  const format = host.querySelector('[aria-label="段落格式"]') as HTMLSelectElement;
  await act(async () => { format.value = 'h3'; format.dispatchEvent(new Event('change', { bubbles: true })); });
  const saved = changed.mock.lastCall![0];
  expect(JSON.stringify(saved.source)).toContain('old-anchor');
  expect(JSON.stringify(saved.source)).toContain('"href":"/original/"');
});

it('does not save imported list normalization when a note merely receives focus', async () => {
  const changed = vi.fn();
  const value = importedDocument('<p>原笔记</p><ul><li><p><strong>场景：</strong>完整内容。</p></li></ul>');
  await act(async () => root.render(<Editor compact value={value} onChange={changed} onMedia={async () => null} onError={error => { throw new Error(error); }} />));
  expect(host.querySelector('[aria-label="正文编辑器"]')?.textContent).toContain('完整内容');
  expect(changed).not.toHaveBeenCalled();
  const first = host.querySelector('[aria-label="正文编辑器"] p')!;
  expect(first.contains(window.getSelection()!.anchorNode)).toBe(true);
});

it('keeps selection formatting working when the toolbar is in the page header', async () => {
  await act(async () => root.render(<Editor toolbarTarget={toolbarHost} value={{ version: 1, format: 'markdown', source: '第一段保留全部文字。\n\n第二段保持原样。' }} onChange={vi.fn()} onMedia={async () => null} onError={vi.fn()} />));
  expect(host.querySelector('[role="toolbar"]')).toBeNull();
  expect(toolbarHost.querySelector('[role="toolbar"]')).not.toBeNull();
  const editable = host.querySelector('[aria-label="正文编辑器"]') as HTMLElement;
  await act(async () => {
    editable.focus();
    const text = document.createTreeWalker(editable.querySelector('p')!, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange(); range.setStart(text, 2); range.collapse(true);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const format = toolbarHost.querySelector('[aria-label="段落格式"]') as HTMLSelectElement;
  await act(async () => { format.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); format.value = 'h2'; format.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(editable.querySelector('h2')?.textContent).toBe('第一段保留全部文字。');
  expect(editable.querySelector('p')?.textContent).toBe('第二段保持原样。');
  await act(async () => { format.value = 'paragraph'; format.dispatchEvent(new Event('change', { bubbles: true })); });
  expect([...editable.querySelectorAll('p')].map(p => p.textContent)).toEqual(['第一段保留全部文字。', '第二段保持原样。']);
});

it('keeps mode switching and the full source when the source toolbar is in the page header', async () => {
  const changed = vi.fn();
  await act(async () => root.render(<Editor toolbarTarget={toolbarHost} value={{ version: 1, format: 'markdown', source: '第一段。\n\n第二段。' }} onChange={changed} onMedia={async () => null} onError={vi.fn()} />));
  await act(async () => [...toolbarHost.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  expect((host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value).toContain('第二段');
  expect(toolbarHost.querySelector('.source-toolbar')).not.toBeNull();
  await act(async () => [...toolbarHost.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为富文本')!.click());
  expect(host.querySelector('[aria-label="正文编辑器"]')?.textContent).toContain('第二段');
  expect(toolbarHost.querySelector('[role="toolbar"]')).not.toBeNull();
});

it('keeps the same first mode button and formatting actions in both modes without rewriting Markdown', async () => {
  const source = '第一段。\n\n**第二段保留原格式。**\n';
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source});return <Editor toolbarTarget={toolbarHost} value={value} onChange={next=>setValue(next as any)} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const actions=()=>[...toolbarHost.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].slice(1).map(button=>button.getAttribute('aria-label'));
  const before=actions();
  expect(toolbarHost.querySelector('.editor-mode-toggle')?.textContent).toBe('');
  expect(toolbarHost.querySelector('.editor-mode-toggle svg')).not.toBeNull();
  expect(toolbarHost.querySelector('[role="toolbar"] > :first-child')?.getAttribute('aria-label')).toBe('切换为 Markdown');
  await act(async()=>toolbarHost.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  expect(toolbarHost.querySelector('[role="toolbar"] > :first-child')?.getAttribute('aria-label')).toBe('切换为富文本');
  expect(toolbarHost.querySelectorAll('.editor-mode-toggle')).toHaveLength(1);
  expect(toolbarHost.querySelector('.editor-mode-toggle')?.textContent).toBe('');
  expect(actions()).toEqual(before);
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(source);
  await act(async()=>toolbarHost.querySelector<HTMLButtonElement>('[aria-label="切换为富文本"]')!.click());
  expect(host.querySelector('.visual-editor strong')?.textContent).toBe('第二段保留原格式。');
});

it('keeps a legacy document unchanged through focus, navigation and display-mode switches', async()=>{
  const value=importedDocument('<p id="original">原有<strong>笔记</strong>。</p><ul><li><p>列表中的完整内容。</p></li></ul>');
  const changed=vi.fn();
  function Harness(){const [document,setDocument]=useState(value);return <Editor compact value={document} onChange={next=>{changed(next);setDocument(next);}} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  await act(async()=>{const editable=host.querySelector<HTMLElement>('.visual-editor')!;editable.focus();editable.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));editable.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));});
  for(let index=0;index<2;index++){
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
    expect(host.querySelector('textarea')?.value).toContain('原有**笔记**');
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为富文本"]')!.click());
  }
  expect(changed).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  const field=host.querySelector('textarea')!;field.setSelectionRange(0,2);
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="加粗"]')!.click());
  expect(changed.mock.lastCall?.[0].format).toBe('markdown');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click());
  expect(changed.mock.lastCall?.[0]).toEqual(value);
});

it('formats the Markdown selection, toggles emphasis, and supports undo, redo and fenced code', async()=>{
  const source='正文\n\n下一段。';
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source});return <Editor value={value} onChange={next=>setValue(next as any)} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const click=clickFormat;
  await click('切换为 Markdown');
  const field=host.querySelector('textarea')!;
  field.setSelectionRange(0,2); await click('加粗');
  expect(field.value).toBe('**正文**\n\n下一段。'); expect([field.selectionStart,field.selectionEnd]).toEqual([2,4]);
  await click('加粗'); expect(field.value).toBe(source);
  field.setSelectionRange(0,2);
  await act(async()=>field.dispatchEvent(new KeyboardEvent('keydown',{key:'i',ctrlKey:true,bubbles:true,cancelable:true})));
  expect(field.value).toBe('*正文*\n\n下一段。');
  await click('撤销'); expect(field.value).toBe(source);
  await click('重做'); expect(field.value).toBe('*正文*\n\n下一段。');
  await click('撤销'); field.setSelectionRange(0,2); await click('代码');
  expect(field.value).toBe('```text\n正文\n```\n\n下一段。');
  await click('插入内容');
  const language=document.querySelector<HTMLSelectElement>('[aria-label="代码语言"]')!;
  await act(async()=>{language.value='python';language.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(field.value).toContain('```python\n正文\n```');
  await click('代码'); expect(field.value).toBe(source);
  field.setSelectionRange(0,source.length); await click('加粗');
  expect(field.value).toBe('**正文**\n\n**下一段。**');
  await click('加粗'); expect(field.value).toBe(source);
});

it('inserts a Markdown link at the preserved selection while a dialog has focus', async()=>{
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'保留这个文字。'});return <Editor value={value} onChange={next=>setValue(next as any)} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  const field=host.querySelector('textarea')!;field.setSelectionRange(2,4);
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="链接"]')!.click());
  const input=document.querySelector<HTMLInputElement>('dialog [aria-label="链接地址"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com/a(b)');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(field.value).toBe('保留[这个](https://example.com/a%28b%29)文字。');
  expect(document.querySelector('dialog')).toBeNull();
});

it('changes selected Markdown lines between lists, quotes and paragraphs without losing text', async()=>{
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'第一行\n第二行\n\n后面的段落。'});return <Editor value={value} onChange={next=>setValue(next as any)} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const click=clickFormat;
  await click('切换为 Markdown');const field=host.querySelector('textarea')!;field.setSelectionRange(0,7);
  await click('无序列表');expect(field.value).toBe('- 第一行\n- 第二行\n\n后面的段落。');
  await click('有序列表');expect(field.value).toBe('1. 第一行\n2. 第二行\n\n后面的段落。');
  await click('引用');expect(field.value).toBe('> 第一行\n> 第二行\n\n后面的段落。');
  const format=host.querySelector<HTMLSelectElement>('[aria-label="段落格式"]')!;
  await act(async()=>{format.value='paragraph';format.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(field.value).toBe('第一行\n第二行\n\n后面的段落。');
});

it('inserts Markdown media with an escaped label, destination and caption', async()=>{
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'保留正文。'});return <Editor value={value} onChange={next=>setValue(next as any)} onMedia={async()=>({id:'photo',kind:'image',url:'/media/a b.png',name:'图[片]',caption:'保留图注'})} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  const field=host.querySelector('textarea')!;field.setSelectionRange(field.value.length,field.value.length);
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="插入媒体"]')!.click());
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="从媒体库选择"]')!.click());
  expect(field.value).toBe('保留正文。\n\n![图\\[片\\]](/media/a%20b.png)\n\n保留图注');
});

it('inspects, changes and removes an existing rich-text link while retaining its bold text', async()=>{
  const changed=vi.fn();
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'正文 [**链接文字**](https://example.com/old) 后文。'});return <Editor value={value} onChange={next=>{changed(next);setValue(next as any);}} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const inspect=async()=>act(async()=>{const click=new MouseEvent('click',{bubbles:true,cancelable:true});host.querySelector('.visual-editor a')!.dispatchEvent(click);expect(click.defaultPrevented).toBe(true);});
  await inspect();
  expect(document.querySelector('[aria-label="链接详情"] a')?.getAttribute('href')).toBe('https://example.com/old');
  expect(changed).not.toHaveBeenCalled();
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="修改链接"] button[aria-label="修改链接"], [aria-label="链接详情"] button[aria-label="修改链接"]')!.click());
  const input=document.querySelector<HTMLInputElement>('[aria-label="修改链接"] input')!;
  expect(input.value).toBe('https://example.com/old');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com/new');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('[aria-label="修改链接"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('.visual-editor a')?.getAttribute('href')).toBe('https://example.com/new');
  expect(host.querySelector('.visual-editor a strong')?.textContent).toBe('链接文字');
  expect(changed.mock.lastCall?.[0].source).toContain('[**链接文字**](https://example.com/new)');
  await inspect();
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="移除链接"]')!.click());
  expect(host.querySelector('.visual-editor a')).toBeNull();
  expect(host.querySelector('.visual-editor strong')?.textContent).toBe('链接文字');
  expect(changed.mock.lastCall?.[0].source).toBe('正文 **链接文字** 后文。');
});

it('cancels rich-text link creation and uses Ctrl+K without losing the selected text or moving the toolbar', async()=>{
  const changed=vi.fn();
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'前文 **加粗文字** 后文。'});return <Editor toolbarTarget={toolbarHost} value={value} onChange={next=>{changed(next);setValue(next as any);}} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const editable=host.querySelector<HTMLElement>('.visual-editor')!;
  await act(async()=>{editable.focus();const range=document.createRange();range.selectNodeContents(editable.querySelector('strong')!);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await act(async()=>toolbarHost.querySelector<HTMLButtonElement>('[aria-label="链接"]')!.click());
  expect(document.querySelector('[aria-label="插入链接"]')).not.toBeNull();
  expect(toolbarHost.querySelector('.inline-input')).toBeNull();
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[aria-label="插入链接"] button')].find(button=>button.textContent==='取消')!.click());
  expect(changed).not.toHaveBeenCalled();
  await act(async()=>editable.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true})));
  const input=document.querySelector<HTMLInputElement>('[aria-label="插入链接"] input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com/selected');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('[aria-label="插入链接"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('.visual-editor a strong')?.textContent).toBe('加粗文字');
  expect(host.querySelector('.visual-editor p')?.textContent).toBe('前文 加粗文字 后文。');
  await act(async()=>toolbarHost.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click());
  expect(host.querySelector('.visual-editor a')).toBeNull();
  expect(host.querySelector('.visual-editor strong')?.textContent).toBe('加粗文字');
});

it('shows an internal content link as its readable path and preserves the content reference when saved unchanged', async()=>{
  const changed=vi.fn();
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'[站内文章](entry:wordpress%3A123)'});return <Editor value={value} onChange={next=>{changed(next);setValue(next as any);}} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  await act(async()=>host.querySelector<HTMLAnchorElement>('.visual-editor a')!.click());
  expect(document.querySelector('[aria-label="链接详情"] a')?.textContent).toBe('/guide/target/');
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="链接详情"] [aria-label="修改链接"]')!.click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="修改链接"] input')?.value).toBe('/guide/target/');
  await act(async()=>document.querySelector('[aria-label="修改链接"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(changed).not.toHaveBeenCalled();
  expect(host.querySelector('.visual-editor')?.textContent).toBe('站内文章');
});

it('links a plain-text substring without restoring offsets from the split text node', async()=>{
  const changed=vi.fn();
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source:'前文 选中文字 后文。'});return <Editor value={value} onChange={next=>{changed(next);setValue(next as any);}} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Harness/>));
  const editable=host.querySelector<HTMLElement>('.visual-editor')!;
  await act(async()=>{editable.focus();const text=document.createTreeWalker(editable.querySelector('p')!,NodeFilter.SHOW_TEXT).nextNode()!;const range=document.createRange();range.setStart(text,3);range.setEnd(text,7);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="链接"]')!.click());
  const input=document.querySelector<HTMLInputElement>('[aria-label="插入链接"] input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com/part');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('[aria-label="插入链接"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(editable.querySelector('a')?.textContent).toBe('选中文字');
  expect(editable.querySelector('p')?.textContent).toBe('前文 选中文字 后文。');
  expect(changed.mock.lastCall?.[0].source).toBe('前文 [选中文字](https://example.com/part) 后文。');
});

it('converts imported features to Markdown while retaining media destinations and embed links', async () => {
  const changed = vi.fn(), error = vi.fn();
  const value = importedDocument('<h2 id="original">标题</h2><p>正文</p><a href="/full/"><img src="/media/a.png" alt="图片"></a><iframe src="about:blank" title="嵌入视频"></iframe>');
  function Harness() { const [document, setDocument] = useState(value); return <Editor value={document} onChange={next => { changed(next); setDocument(next); }} onMedia={async () => null} onError={error} />; }
  await act(async () => root.render(<Harness />));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const source = (host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value;
  expect(source).toContain('[![图片](/media/a.png)](/full/)');
  expect(source).toContain('<iframe src="about:blank" title="嵌入视频"');
  expect(source).toContain('## 标题');
  expect(error).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为富文本')!.click());
  expect(host.querySelector('[aria-label="正文编辑器"]')).not.toBeNull();
  expect(host.querySelector('.editor-media img')?.getAttribute('alt')).toBe('图片');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  expect((host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value).toContain('[![图片](/media/a.png)](/full/)');
  expect(error).not.toHaveBeenCalled();
});

it('copies complete code without changing the document or including the copy control in Markdown', async () => {
  const changed = vi.fn(), copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    const value = importedDocument('<pre><code class="language-js">first\n\n  next()</code></pre><p>代码后的正文</p>');
    function Harness() { const [document, setDocument] = useState(value); return <Editor value={document} onChange={next => { changed(next); setDocument(next); }} onMedia={async () => null} onError={vi.fn()} />; }
    await act(async () => root.render(<Harness />));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!;
    expect(button).not.toBeNull();
    expect(button.closest('[contenteditable]')).toBeNull();
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledWith('first\n\n  next()');
    expect(button.textContent).toBe('已复制'); expect(changed).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
    const markdown = (host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value;
    expect(markdown).toContain('first\n\n  next()'); expect(markdown).not.toContain('复制');
  } finally { copy.mockRestore(); }
});

it('opens Markdown containing HTML code visually and preserves media captions and tables when converting', async () => {
  const changed = vi.fn(), error = vi.fn();
  const value = importedDocument('<p>正文</p><figure><img src="/media/photo.png" alt="图片"><figcaption>原有图注</figcaption></figure><video src="/media/movie.mp4"></video><table>\n<tr>\n<th>标题</th><td>内容</td>\n</tr>\n</table><pre><code class="language-html">&lt;div&gt;保留代码&lt;/div&gt;\n\n  next</code></pre>');
  function Harness() { const [document, setDocument] = useState(value); return <Editor value={document} onChange={next => { changed(next); setDocument(next); }} onMedia={async () => null} onError={error} />; }
  await act(async () => root.render(<Harness />));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const source = (host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value;
  expect(source).toContain('![图片](/media/photo.png)\n\n原有图注');
  expect(source).toContain('<video src="/media/movie.mp4" controls');
  expect(source).toContain('| 标题 | 内容 |');
  expect(source).toContain('<div>保留代码</div>\n\n  next');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为富文本')!.click());
  expect(host.querySelector('.visual-editor .editor-codeblock')?.textContent).toContain('<div>保留代码</div>');
  expect(host.querySelector('.visual-editor table')?.textContent).toContain('内容');
  expect(error).not.toHaveBeenCalled();
});

it('retains code inside list items as fenced Markdown with its indentation and blank lines', async () => {
  const value = importedDocument('<ol><li><p>第一步</p><pre><code class="language-js">  first()\n\n  next()</code></pre></li><li>第二步</li></ol>');
  let saved: any;
  function Harness() { const [document, setDocument] = useState(value); return <Editor value={document} onChange={next => { saved = next; setDocument(next); }} onMedia={async () => null} onError={error => { throw new Error(error); }} />; }
  await act(async () => root.render(<Harness />));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  expect(renderDocument({version:1,format:'markdown',source:(host.querySelector('textarea') as HTMLTextAreaElement).value})).toContain(encodeURIComponent('  first()\n\n  next()\n'));
  expect(saved).toBeUndefined();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为富文本')!.click());
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!.click());
    expect(copy).toHaveBeenCalledWith('  first()\n\n  next()');
  } finally { copy.mockRestore(); }
});

it('uses the same Markdown grammar as the public page for all common formats and round trips them', async () => {
  let saved: any; const error = vi.fn(), changed = vi.fn();
  function Harness() {
    const [document, setDocument] = useState({version:1 as const, format:'markdown' as const, source:markdownFormats});
    return <Editor value={document} onChange={next => {saved=next; changed(next); setDocument(next as any);}} onMedia={async()=>null} onError={error}/>;
  }
  await act(async()=>root.render(<Harness/>));
  expect(host.querySelector('.visual-editor')).not.toBeNull();
  expect(host.querySelectorAll('.visual-editor h1,h2,h3,h4,h5,h6')).toHaveLength(6);
  expect(host.querySelectorAll('.visual-editor .editor-codeblock')).toHaveLength(5);
  expect(host.querySelectorAll('.visual-editor [role="checkbox"]')).toHaveLength(3);
  expect(host.querySelectorAll('.visual-editor table')).toHaveLength(4);
  expect(host.querySelector('.visual-editor s,.editor-strikethrough')?.textContent).toBe('删除线');
  expect(changed).not.toHaveBeenCalled();
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const $=load(renderDocument({version:1,format:'markdown',source:(host.querySelector('textarea') as HTMLTextAreaElement).value})), original=load(renderDocument({version:1,format:'markdown',source:markdownFormats}));
  expect($('h1,h2,h3,h4,h5,h6').map((_i,node)=>$(node).text()).get()).toEqual(original('h1,h2,h3,h4,h5,h6').map((_i,node)=>original(node).text()).get());
  expect($('table')).toHaveLength(4); expect($('th').eq(1).attr('align')).toBe('center');
  expect($('input[type="checkbox"]')).toHaveLength(3); expect($('input[checked]')).toHaveLength(2);
  expect($('a[href="https://example.com/reference"]').text()).toBe('引用链接');
  expect($('a[href="https://example.com/full"] img').attr('src')).toBe('/default-covers/picsum-10.webp');
  const sources=$('pre[data-code-source]').map((_i,node)=>decodeURIComponent($(node).attr('data-code-source')!)).get();
  expect(sources).toHaveLength(5); expect(sources.some(code=>code.includes('```js\ninside()\n```'))).toBe(true);
  expect(sources.some(code=>code.includes('\tconsole.log(message)'))).toBe(true);
  expect($('hr')).toHaveLength(1); expect(error).not.toHaveBeenCalled();
  expect($('blockquote blockquote')).toHaveLength(1);
  expect($('br').length).toBeGreaterThanOrEqual(1);
  expect($('ol[start="3"]')).toHaveLength(1);
});

it.each([
  ['literal characters', '\\<span>这不是 HTML\\</span>，\\&copy; 与 &amp;，\\[不是链接\\]。', 0],
  ['mixed task list', '- 普通项目\n- [x] 已完成\n- 另一个普通项目', 1],
  ['table line breaks', '| 标题 | 内容 |\n| --- | --- |\n| 第一行<br>第二行 | a\\|b |', 0],
  ['nested tasks', '- [x] 父任务\n  - [ ] 子任务', 2],
])('preserves %s while editing and converting', async (_name, source, tasks) => {
  let saved: any; const error=vi.fn();
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source});return <Editor value={value} onChange={next=>{saved=next;setValue(next as any);}} onMedia={async()=>null} onError={error}/>;}
  await act(async()=>root.render(<Harness/>));
  expect(host.querySelector('.visual-editor')).not.toBeNull(); expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(Number(tasks));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const before=load(renderDocument({version:1,format:'markdown',source})),after=load(renderDocument({version:1,format:'markdown',source:(host.querySelector('textarea') as HTMLTextAreaElement).value}));
  expect(after('body').text().replace(/\s+/g,'')).toBe(before('body').text().replace(/\s+/g,''));
  expect(after('br').length).toBe(before('br').length); expect(after('input[type="checkbox"]').length).toBe(Number(tasks)); expect(error).not.toHaveBeenCalled();
});

it('retains code line numbers and highlighted line options through visual editing', async()=>{
  let saved: any;
  const source='```ts linenos {2}\nconst one = 1;\nconst two = 2;\n```';
  function Harness(){const [value,setValue]=useState({version:1 as const,format:'markdown' as const,source});return <Editor value={value} onChange={next=>{saved=next;setValue(next as any);}} onMedia={async()=>null} onError={error=>{throw new Error(error);}}/>;}
  await act(async()=>root.render(<Harness/>));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const $=load(renderDocument({version:1,format:'markdown',source:(host.querySelector('textarea') as HTMLTextAreaElement).value}));
  expect($('pre.line-numbers')).toHaveLength(1); expect($('.code-line.highlighted').attr('data-line')).toBe('2');
});

it('lets the keyboard change a task state and saves it as Markdown', async()=>{
  const changed=vi.fn();
  await act(async()=>root.render(<Editor value={{version:1,format:'markdown',source:'- [ ] 待完成'}} onChange={changed} onMedia={async()=>null} onError={error=>{throw new Error(error);}}/>));
  const task=host.querySelector<HTMLElement>('[role="checkbox"]')!;
  await act(async()=>{task.focus();task.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));});
  expect(task.getAttribute('aria-checked')).toBe('true'); expect(changed.mock.lastCall?.[0].source).toContain('- [x] 待完成');
});

it('opens media editing outside the document and saves only confirmed dialog changes', async()=>{
  const changed=vi.fn();
  function Harness(){const [value,setValue]=useState(importedDocument('<p>正文</p><figure><a href="https://example.com/full"><img src="/media/photo.png" alt="图片"></a><figcaption>原有图注</figcaption></figure>'));return <Editor value={value} onChange={next=>{changed(next);setValue(next);}} onMedia={async()=>null} onError={error=>{throw new Error(error);}}/>;}
  await act(async()=>root.render(<Harness/>));
  const open=async()=>act(async()=>{const click=new MouseEvent('click',{bubbles:true,cancelable:true});host.querySelector<HTMLButtonElement>('.editor-media-edit')!.dispatchEvent(click);expect(click.defaultPrevented).toBe(true);});
  const fillCaption=async(value:string)=>act(async()=>{const dialog=document.querySelector('dialog[aria-label="编辑媒体"]')!;const field=[...dialog.querySelectorAll('label')].find(label=>label.textContent==='图注')!.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('.editor-media-edit')?.textContent).toBe('');
  await open();
  expect(document.querySelector('dialog[aria-label="编辑媒体"]')?.closest('[contenteditable]')).toBeNull();
  await fillCaption('取消的改动');
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('dialog[aria-label="编辑媒体"] button')].find(button=>button.textContent==='取消')!.click());
  expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('figcaption')?.textContent).toBe('原有图注');
  await open(); await fillCaption('新的图注');
  await act(async()=>document.querySelector<HTMLFormElement>('dialog[aria-label="编辑媒体"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(document.querySelector('dialog[aria-label="编辑媒体"]')).toBeNull();
  expect(host.querySelector('figcaption')?.textContent).toBe('新的图注');
  expect(changed.mock.lastCall?.[0].source).toContain('新的图注'); expect(changed.mock.lastCall?.[0].source).not.toContain('保存修改');
});
