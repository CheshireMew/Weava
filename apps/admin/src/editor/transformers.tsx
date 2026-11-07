import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNodeWithDimensions,
  $isTableRowNode,
  $isTableCellNode,
} from '@lexical/table';
import { TRANSFORMERS, CODE, $convertFromMarkdownString, type Transformer } from '@lexical/markdown';
import { $createParagraphNode, $isParagraphNode, $isLineBreakNode, $isTextNode, $getState, type ElementNode, type LexicalNode } from 'lexical';
import {CodeNode} from '@lexical/code';
import {$isListNode, $isListItemNode, ListNode, ListItemNode} from '@lexical/list';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {QuoteNode, HeadingNode} from '@lexical/rich-text';
import { MediaNode, EmbedNode } from './nodes.tsx';
import {codeMetadata} from './markdown.ts';

const codeBlock: Transformer = {
  ...CODE,
  export: (node: LexicalNode, traverse: (node: ElementNode) => string) => {
    const source = CODE.export!(node, traverse);
    if (!(node instanceof CodeNode) || source === null) return source;
    const metadata = $getState(node, codeMetadata);
    return metadata ? source.replace(/^[^\n]+/, line => line + ' ' + metadata) : source;
  },
};

const markdownLabel = (value: string) => value.replace(/[\\`*_[\]<>]/g, '\\$&');
const markdownUrl = (value: string) => value.replace(/[\s()]/g, character => encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'));
const mediaMarkdown = (node: import('lexical').LexicalNode) => {
  if (!(node instanceof MediaNode)) return null;
  let source = node.__kind === 'image' ? `![${markdownLabel(node.__alt)}](${markdownUrl(node.__src)})`
    : `[${markdownLabel(node.__alt || ({video:'视频',audio:'音频',file:'下载附件'}[node.__kind] ?? '附件'))}](${markdownUrl(node.__src)})`;
  if (node.__kind === 'image' && node.__href) source = `[${source}](${markdownUrl(node.__href)})`;
  return source + (node.__caption ? '\n\n' + markdownLabel(node.__caption) : '');
};

export const linkedImage: Transformer = {
  type: 'text-match', dependencies: [MediaNode],
  regExp: /\[!\[((?:\\.|[^\]])*)\]\(([^)]+)\)\]\(([^)]+)\)$/,
  importRegExp: /\[!\[((?:\\.|[^\]])*)\]\(([^)]+)\)\]\(([^)]+)\)/,
  replace: (node, match) => { const image = new MediaNode(match[2], match[1].replace(/\\([\\`*_[\]<>])/g, '$1')); image.__href = match[3]; node.replace(image); },
  export: mediaMarkdown,
};

export const image: Transformer = {
  type: 'text-match',
  dependencies: [MediaNode],
  regExp: /!\[((?:\\.|[^\]])*)\]\(([^)]+)\)$/,
  importRegExp: /!\[((?:\\.|[^\]])*)\]\(([^)]+)\)/,
  replace: (node, match) => {
    node.replace(new MediaNode(match[2], match[1].replace(/\\([\\`*_[\]<>])/g, '$1')));
  },
  export: mediaMarkdown,
};

export const embed: Transformer = {
  type: 'text-match', dependencies: [EmbedNode], regExp: /$^/,
  replace: () => {},
  export: node => node instanceof EmbedNode ? `[${markdownLabel(node.__value.title || '嵌入内容')}](${markdownUrl(node.__value.src)})` : null,
};

const mediaBlock: Transformer = {
  type: 'element', dependencies: [MediaNode, EmbedNode, HorizontalRuleNode], regExp: /$^/,
  replace: () => false,
  export: node => mediaMarkdown(node) ?? (node instanceof EmbedNode ? `[${markdownLabel(node.__value.title || '嵌入内容')}](${markdownUrl(node.__value.src)})` : node instanceof HorizontalRuleNode ? '---' : null),
};

function listMarkdown(node: ListNode, traverse: (node: ElementNode) => string): string {
  let index = 0;
  return node.getChildren().filter($isListItemNode).map(item => {
    const child = item.getFirstChild();
    if (item.getChildrenSize() === 1 && $isListNode(child)) return listMarkdown(child, traverse).split('\n').map(line => '    ' + line).join('\n');
    const prefix = node.getListType() === 'number' ? `${node.getStart() + index++}. ` : node.getListType() === 'check' ? `- [${item.getChecked() ? 'x' : ' '}] ` : '- ';
    return prefix + traverse(item).replace(/\n/g, '\n' + ' '.repeat(prefix.length));
  }).join('\n');
}
const listBlock: Transformer = {
  type: 'element', dependencies: [ListNode, ListItemNode], regExp: /$^/, replace: () => false,
  export: (node, traverse) => $isListNode(node) ? listMarkdown(node, traverse) : null,
};
const nestedBlock: Transformer = {
  type: 'text-match', dependencies: [CodeNode, ListNode, QuoteNode, HeadingNode, HorizontalRuleNode], regExp: /$^/, replace: () => {},
  export: (node: LexicalNode, traverse: (node: ElementNode) => string) => {
    if (node instanceof CodeNode) return '\n\n' + codeBlock.export!(node, traverse) + '\n\n';
    if ($isListNode(node)) return '\n' + listMarkdown(node, traverse);
    if ($isLineBreakNode(node)) return '  \n';
    if ($isParagraphNode(node)) return traverse(node) + '\n\n';
    if (node instanceof QuoteNode) return '\n\n' + traverse(node).trimEnd().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (node instanceof HeadingNode) return '#'.repeat(Number(node.getTag().slice(1))) + ' ' + traverse(node) + '\n\n';
    if (node instanceof HorizontalRuleNode) return '\n\n---\n\n';
    return null;
  },
};

const literalText: Transformer = {
  type: 'text-match', dependencies: [], regExp: /$^/, replace: () => {},
  export: (node, _children, format) => $isTextNode(node) && !node.hasFormat('code')
    ? format(node, node.getTextContent()).replace(/[<>&]/g, '\\$&') : null,
};

export const table: Transformer = {
  type: 'multiline-element',
  dependencies: [TableNode, TableRowNode, TableCellNode],
  regExpStart: /^\|.+\|\s*$/,
  replace: () => false,
  handleImportAfterStartMatch: ({ lines, startLineIndex, rootNode }) => {
    if (!/^\|[\s:|-]+\|\s*$/.test(lines[startLineIndex + 1] ?? '')) return null;
    let end = startLineIndex + 2;
    while (/^\|.+\|\s*$/.test(lines[end] ?? '')) end++;
    const rows = [lines[startLineIndex], ...lines.slice(startLineIndex + 2, end)].map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, '|')),
    );
    const t = $createTableNodeWithDimensions(
      rows.length,
      Math.max(...rows.map((r) => r.length)),
      true,
    );
    t.getChildren().forEach((r: any, i: number) =>
      r.getChildren().forEach((cell: any, j: number) => {
        cell.clear();
        const p = $createParagraphNode();
        $convertFromMarkdownString(rows[i][j] ?? '', TRANSFORMERS, p);
        cell.append(
          ...p
            .getChildren()
            .map((n: any) => (n.getType() === 'paragraph' ? n : $createParagraphNode().append(n))),
        );
        if (!cell.getChildrenSize()) cell.append($createParagraphNode());
      }),
    );
    rootNode.append(t);
    return [true, end - 1];
  },
  export: (node, traverse) => {
    if (!(node instanceof TableNode)) return null;
    const alignment = node.getChildren().filter($isTableRowNode)[0]?.getChildren().filter($isTableCellNode).map(cell => cell.getFormatType()) ?? [];
    const rows = node
      .getChildren()
      .filter($isTableRowNode)
      .map((r: any) =>
        r.getChildren().filter($isTableCellNode).map((c: any) => traverse(c).trim().replace(/ {2,}\n/g, '<br>').replace(/\n/g, '<br>').replace(/\|/g, '\\|')),
      );
    return rows
      .map(
        (r: string[], i: number) =>
          '| ' +
          r.join(' | ') +
          ' |' +
          (i === 0 ? '\n| ' + r.map((_cell, column) => alignment[column] === 'center' ? ':---:' : alignment[column] === 'right' ? '---:' : alignment[column] === 'left' ? ':---' : '---').join(' | ') + ' |' : ''),
      )
      .join('\n');
  },
};

export const transformers = [table, codeBlock, mediaBlock, listBlock, linkedImage, image, embed, nestedBlock, literalText, ...TRANSFORMERS];
