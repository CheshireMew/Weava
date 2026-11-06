import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNodeWithDimensions,
} from '@lexical/table';
import { TRANSFORMERS, $convertFromMarkdownString, type Transformer } from '@lexical/markdown';
import { $createParagraphNode } from 'lexical';
import { MediaNode } from './nodes.tsx';

export const image: Transformer = {
  type: 'text-match',
  dependencies: [MediaNode],
  regExp: /!\[([^\]]*)\]\(([^)]+)\)$/,
  importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  replace: (node, match) => {
    node.replace(new MediaNode(match[2], match[1]));
  },
  export: (node) =>
    node instanceof MediaNode
      ? node.__kind !== 'image' || node.__caption
        ? (node.exportDOM().element as HTMLElement).outerHTML
        : `![${node.__alt}](${node.__src})`
      : null,
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
    const rows = node
      .getChildren()
      .map((r: any) =>
        r.getChildren().map((c: any) => traverse(c).replace(/\n/g, ' ').replace(/\|/g, '\\|')),
      );
    return rows
      .map(
        (r: string[], i: number) =>
          '| ' +
          r.join(' | ') +
          ' |' +
          (i === 0 ? '\n| ' + r.map(() => '---').join(' | ') + ' |' : ''),
      )
      .join('\n');
  },
};

export const transformers = [table, image, ...TRANSFORMERS];
