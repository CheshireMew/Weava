// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Editor } from '../apps/admin/src/Editor.tsx';

vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => null }) }));
let host: HTMLDivElement, toolbarHost: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); toolbarHost = document.createElement('div'); document.body.append(toolbarHost, host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); toolbarHost.remove(); });

it('opens supported Markdown visually by default without changing its stored content', async () => {
  const changed = vi.fn();
  await act(async () => root.render(<Editor value={{ version: 1, format: 'markdown', source: '一段**加粗**的正文。' }} onChange={changed} onMedia={async () => null} onError={vi.fn()} />));
  expect(host.querySelector('[aria-label="正文编辑器"] strong')?.textContent).toBe('加粗');
  expect(host.querySelector('[aria-label="段落格式"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="代码语言"]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('preserves source mode for content that cannot convert losslessly', async () => {
  const changed = vi.fn(), error = vi.fn();
  const source = '<section><custom-content>原始内容</custom-content></section>';
  await act(async () => root.render(<Editor value={{ version: 1, format: 'html', source }} onChange={changed} onMedia={async () => null} onError={error} />));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '可视化编辑')!.click());
  expect(error).toHaveBeenCalledWith(expect.stringContaining('不能无损转换'));
  expect((host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value).toBe(source);
  expect(changed).not.toHaveBeenCalled();
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
  await act(async () => [...toolbarHost.querySelectorAll('button')].find(button => button.textContent === 'Markdown')!.click());
  expect((host.querySelector('[aria-label="正文源码"]') as HTMLTextAreaElement).value).toContain('第二段');
  expect(toolbarHost.querySelector('.source-toolbar')).not.toBeNull();
  await act(async () => [...toolbarHost.querySelectorAll('button')].find(button => button.textContent === '可视化编辑')!.click());
  expect(host.querySelector('[aria-label="正文编辑器"]')?.textContent).toContain('第二段');
  expect(toolbarHost.querySelector('[role="toolbar"]')).not.toBeNull();
});
