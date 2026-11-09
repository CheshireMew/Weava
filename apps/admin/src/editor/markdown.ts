import {$getRoot, $isElementNode, $setState, createState, type LexicalEditor, type LexicalNode} from 'lexical';
import {CodeNode} from '@lexical/code';
import {$generateNodesFromDOM} from '@lexical/html';
import {$isTableCellNode} from '@lexical/table';
import type {Document} from '@weava/contracts';
import {createMarkdownParser, markdownFootnotes} from '../../../../packages/runtime-common/src/markdown.ts';
import {FootnoteNode, writingDescendants} from './WritingNodes.tsx';

const parser = createMarkdownParser();
let parsed: {source:string;tokens:ReturnType<typeof parser.parse>;env:any}|undefined;
function parse(source:string){
  if(parsed?.source===source)return parsed;
  const env:any={},tokens=parser.parse(source,env);
  return parsed={source,tokens,env};
}
export const codeMetadata = createState('weavaCodeMetadata', {parse: value => typeof value === 'string' ? value : ''});
export const footnoteOrphans = createState('weavaFootnoteOrphans', {parse: (value): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, source]) => typeof source === 'string')) as Record<string, string> : {}});

const inlineHTML = /^(?:<\/?(?:strong|em|s|u|sub|sup|mark|code)>|<mark class="weava-highlight-(?:yellow|green|blue|pink)">|<span class="weava-color-(?:accent|red|blue|green|muted)">|<\/span>|<a(?: class="weava-link-button")? href="[^"]*">|<\/a>|<br\s*\/?>)$/i;
const blockHTML = /^(?:<details(?: class="weava-details")?>\s*<summary>[^<]*<\/summary>|<\/details>|<div class="weava-align-(?:center|right|justify)">|<\/div>)\s*$/i;
const mediaHTML = /^(?:<figure><(video|audio) src="[^"]*" controls preload="metadata"><\/\1>(?:<figcaption>[^<]*<\/figcaption>)?<\/figure>|<iframe src="[^"]*" title="[^"]*"(?: width="[^"]*")?(?: height="[^"]*")? allowfullscreen><\/iframe>)\s*$/i;

export function supportsVisualEditing(document: Document) {
  if (document.format === 'lexical') return true;
  if (document.format !== 'markdown') return false;
  const supported = (tokens: ReturnType<typeof parser.parse>): boolean => tokens.every(token => token.meta?.weavaTask ||
    !(token.type === 'html_block' && !blockHTML.test(token.content.trim()) && !mediaHTML.test(token.content.trim())) && !(token.type === 'html_inline' && !inlineHTML.test(token.content)) &&
    !(token.type === 'text' && /(?:^::|\$\$)/m.test(token.content)) && (!token.children || supported(token.children)));
  // The checkboxes are generated from Markdown, rather than authored HTML.
  const {tokens}=parse(document.source);
  return supported(tokens);
}

export function importMarkdown(editor: LexicalEditor, source: string) {
  const root = $getRoot(); root.clear(); $setState(root, footnoteOrphans, {});
  root.append(...markdownNodes(editor, source));
}

export function markdownChunks(source:string){
  const {tokens}=parse(source),chunks:typeof tokens[]=[],chunk:typeof tokens=[];let depth=0,blocks=0;
  for(const token of tokens){chunk.push(token);depth+=token.nesting;if(depth===0&&++blocks>=512){chunks.push(chunk.splice(0));blocks=0;}}
  if(chunk.length)chunks.push(chunk);return chunks;
}
export function markdownNodes(editor: LexicalEditor, source: string,selected?:ReturnType<typeof parser.parse>) {
  const parsed=parse(source),env=parsed.env,tokens=selected??parsed.tokens,codeBlocks = tokens.filter(token => token.type === 'fence' || token.type === 'code_block');
  const document = new DOMParser().parseFromString(parser.renderer.render(tokens, parser.options, env), 'text/html');
  const notes = markdownFootnotes(env), existing = new Map(notes.length?writingDescendants().filter(node => node instanceof FootnoteNode).map(node => [(node as FootnoteNode).getLabel(), (node as FootnoteNode).getSource()]):[]);
  const labels = notes.map(note => {
    let label = note.label, suffix = 1;
    while (existing.has(label) && existing.get(label) !== note.source) label = note.label + '-' + ++suffix;
    existing.set(label, note.source); return label;
  });
  document.querySelectorAll('sup.footnote-ref').forEach(reference => {
    const number = Number(/#fn(\d+)/.exec(reference.querySelector('a')?.getAttribute('href') ?? '')?.[1]) - 1;
    if (!notes[number]) return;
    const marker = document.createElement('span'); marker.setAttribute('data-weava-footnote', labels[number]); marker.setAttribute('data-weava-footnote-source', notes[number].source); reference.replaceWith(marker);
  });
  document.querySelectorAll('.footnotes,.footnotes-sep').forEach(element => element.remove());
  const referenced = new Set(notes.map(note => note.label));
  const orphaned = Object.fromEntries(Object.entries(env.weavaFootnoteSources ?? {}).filter(([label]) => !referenced.has(label)));
  if (Object.keys(orphaned).length) $setState($getRoot(), footnoteOrphans, previous => ({...previous, ...orphaned as Record<string, string>}));
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
  const nodes = $generateNodesFromDOM(editor, document);
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
  nodes.forEach(align);
  return nodes;
}
