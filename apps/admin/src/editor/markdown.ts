import {$getRoot, $isElementNode, $setState, createState, type LexicalEditor, type LexicalNode} from 'lexical';
import {CodeNode} from '@lexical/code';
import {$generateNodesFromDOM} from '@lexical/html';
import {$isTableCellNode} from '@lexical/table';
import type {Document} from '@weava/contracts';
import {createMarkdownParser} from '../../../../packages/runtime-common/src/markdown.ts';

const parser = createMarkdownParser();
export const codeMetadata = createState('weavaCodeMetadata', {parse: value => typeof value === 'string' ? value : ''});

export function supportsVisualEditing(document: Document) {
  if (document.format === 'lexical') return true;
  if (document.format !== 'markdown') return false;
  const supported = (tokens: ReturnType<typeof parser.parse>): boolean => tokens.every(token =>
    token.type !== 'html_block' && !(token.type === 'html_inline' && !/^<br\s*\/?>$/i.test(token.content)) &&
    !(token.type === 'text' && /(?:^::|\$\$|\[\^)/m.test(token.content)) && (!token.children || supported(token.children)));
  // The checkboxes are generated from Markdown, rather than authored HTML.
  const tokens = parser.parse(document.source, {});
  tokens.forEach(token => { if (token.children) token.children = token.children.filter(child => !child.meta?.weavaTask); });
  return supported(tokens);
}

export function importMarkdown(editor: LexicalEditor, source: string) {
  const tokens = parser.parse(source, {}), codeBlocks = tokens.filter(token => token.type === 'fence' || token.type === 'code_block');
  const document = new DOMParser().parseFromString(parser.renderer.render(tokens, parser.options, {}), 'text/html');
  document.querySelectorAll('pre').forEach(block => {
    const code = block.querySelector('code');
    const language = /(?:^|\s)language-([^\s]+)/.exec(code?.className ?? '')?.[1];
    if (language) block.setAttribute('data-language', language);
    // One code node owns the block; a nested <code> would import a second one.
    // The closing Markdown fence contributes one presentation newline.
    block.replaceChildren(document.createTextNode((code?.textContent ?? block.textContent ?? '').replace(/\n$/, '')));
  });
  // A Lexical list has one kind. Split mixed Markdown lists into consecutive
  // groups so ordinary items do not turn into unchecked tasks.
  [...document.querySelectorAll('ul.contains-task-list,ol.contains-task-list')].reverse().forEach(list => {
    const items = [...list.children].filter(item => item.tagName === 'LI');
    if (list.tagName === 'UL' && items.every(item => item.classList.contains('task-list-item'))) return;
    const fragment = document.createDocumentFragment(); let group: HTMLElement | null = null, previous: boolean | undefined;
    items.forEach((item, index) => {
      const task = item.classList.contains('task-list-item');
      if (task !== previous) {
        group = document.createElement(task ? 'ul' : list.tagName.toLowerCase());
        if (task) group.className = 'contains-task-list';
        else if (list.tagName === 'OL') group.setAttribute('start', String(Number(list.getAttribute('start') ?? 1) + index));
        fragment.append(group); previous = task;
      }
      group!.append(item);
    });
    list.replaceWith(fragment);
  });
  document.querySelectorAll('li.task-list-item').forEach(item => {
    const input = item.querySelector('input[type="checkbox"]');
    if (input) { item.setAttribute('aria-checked', String(input.hasAttribute('checked'))); input.remove(); }
  });
  const root = $getRoot(); root.clear(); root.append(...$generateNodesFromDOM(editor, document));
  const cells = [...document.querySelectorAll<HTMLTableCellElement>('td,th')]; let cell = 0, code = 0;
  const align = (node: LexicalNode) => {
    if (node instanceof CodeNode) {
      const info = codeBlocks[code++]?.info.trim() ?? '';
      $setState(node, codeMetadata, info.replace(/^\S+\s*/, ''));
    }
    if ($isTableCellNode(node)) {
      const value = cells[cell++]?.style.textAlign;
      if (value === 'left' || value === 'center' || value === 'right') node.setFormat(value);
    }
    if ($isElementNode(node)) node.getChildren().forEach(align);
  };
  align(root);
}
