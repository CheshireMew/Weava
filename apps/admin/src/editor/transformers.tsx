import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNodeWithDimensions,
  $isTableRowNode,
  $isTableCellNode,
} from '@lexical/table';
import { TRANSFORMERS, CODE, $convertFromMarkdownString, $convertToMarkdownString, type Transformer, type TextMatchTransformer } from '@lexical/markdown';
import { $createParagraphNode, $getRoot, $isParagraphNode, $isElementNode, $isLineBreakNode, $isTextNode, $getState, type ElementNode, type LexicalNode } from 'lexical';
import {CodeNode} from '@lexical/code';
import {$isListNode, $isListItemNode, ListNode, ListItemNode} from '@lexical/list';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {QuoteNode, HeadingNode} from '@lexical/rich-text';
import { MediaNode, EmbedNode } from './nodes.tsx';
import {codeMetadata, footnoteOrphans} from './markdown.ts';
import {ButtonLinkNode, DetailsNode, FootnoteNode, writingDescendants} from './WritingNodes.tsx';
import {$isLinkNode} from '@lexical/link';
import {escapeWritingHtml, writingStyles, inlineCode} from '../../../../packages/runtime-common/src/writing-format.ts';

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
  if (node.__kind === 'video' || node.__kind === 'audio') return `<figure><${node.__kind} src="${escapeWritingHtml(node.__src)}" controls preload="metadata"></${node.__kind}>${node.__caption ? '<figcaption>' + escapeWritingHtml(node.__caption) + '</figcaption>' : ''}</figure>`;
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
  export: node => node instanceof EmbedNode ? embedMarkdown(node) : null,
};
function embedMarkdown(node: EmbedNode) {return `<iframe src="${escapeWritingHtml(node.__value.src)}" title="${escapeWritingHtml(node.__value.title)}"${node.__value.width ? ' width="' + escapeWritingHtml(node.__value.width) + '"' : ''}${node.__value.height ? ' height="' + escapeWritingHtml(node.__value.height) + '"' : ''} allowfullscreen></iframe>`;}

const mediaBlock: Transformer = {
  type: 'element', dependencies: [MediaNode, EmbedNode, HorizontalRuleNode], regExp: /$^/,
  replace: () => false,
  export: node => mediaMarkdown(node) ?? (node instanceof EmbedNode ? embedMarkdown(node) : node instanceof HorizontalRuleNode ? '---' : null),
};

function listMarkdown(node: ListNode, traverse: (node: ElementNode) => string): string {
  let index = 0;
  return node.getChildren().filter($isListItemNode).map(item => {
    const child = item.getFirstChild();
    if (item.getChildrenSize() === 1 && $isListNode(child)) return listMarkdown(child, traverse).split('\n').map(line => '    ' + line).join('\n');
    const prefix = node.getListType() === 'number' ? `${node.getStart() + index++}. ` : node.getListType() === 'check' ? `- [${item.getChecked() ? 'x' : ' '}] ` : '- ';
    const rich = writingDescendants(item).some(extendedText);
    const content = rich ? richChildren(item, traverse).trimEnd() : traverse(item);
    return prefix + content.replace(/\n/g, '\n' + ' '.repeat(prefix.length));
  }).join('\n');
}
const listBlock: Transformer = {
  type: 'element', dependencies: [ListNode, ListItemNode], regExp: /$^/, replace: () => false,
  export: (node, traverse) => $isListNode(node) ? listMarkdown(node, traverse) : null,
};
const nestedBlock: TextMatchTransformer = {
  type: 'text-match', dependencies: [CodeNode, ListNode, QuoteNode, HeadingNode, HorizontalRuleNode], regExp: /$^/, replace: () => {},
  export: (node: LexicalNode, traverse: (node: ElementNode) => string) => {
    if (node instanceof CodeNode) return '\n\n' + codeBlock.export!(node, traverse) + '\n\n';
    if ($isListNode(node)) return '\n' + listMarkdown(node, traverse);
    if ($isLineBreakNode(node)) return '  \n';
    if ($isParagraphNode(node)) return blockContent(node, traverse) + '\n\n';
    if (node instanceof QuoteNode) return '\n\n' + blockContent(node, traverse).trimEnd().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (node instanceof HeadingNode) return '#'.repeat(Number(node.getTag().slice(1))) + ' ' + blockContent(node, traverse) + '\n\n';
    if (node instanceof DetailsNode) return '\n\n' + detailsMarkdown(node) + '\n\n';
    if (node instanceof HorizontalRuleNode) return '\n\n---\n\n';
    return null;
  },
};

const literalText: Transformer = {
  type: 'text-match', dependencies: [], regExp: /$^/, replace: () => {},
  export: (node, _children, format) => {
    if (!$isTextNode(node)) return null;
    return format(node, node.getTextContent()).replace(/[<>&]/g, '\\$&');
  },
};

const extendedText = (node: LexicalNode) => $isTextNode(node) && (['underline','subscript','superscript','highlight'].some(flag => node.hasFormat(flag as any)) || !!writingStyles(node.getStyle()).color);
// HTML spans keep overlapping rich formats balanced; ordinary paragraphs retain Markdown emphasis.
function richInline(node: LexicalNode): string {
  if ($isTextNode(node)) {
    let text = escapeWritingHtml(node.getTextContent()).replace(/[\\`*_[\]~]/g, '\\$&');
    if (node.hasFormat('code')) text = inlineCode(node.getTextContent());
    for (const [flag, tag] of [['bold','strong'],['italic','em'],['strikethrough','s'],['underline','u'],['subscript','sub'],['superscript','sup']] as const) if (node.hasFormat(flag)) text = `<${tag}>${text}</${tag}>`;
    const styles = writingStyles(node.getStyle());
    if (styles.color) text = `<span class="weava-color-${styles.color}">${text}</span>`;
    if (node.hasFormat('highlight')) text = `<mark class="weava-highlight-${styles.highlight ?? 'yellow'}">${text}</mark>`;
    return text;
  }
  if (node instanceof FootnoteNode) return `[^${node.getLabel()}]`;
  if ($isLineBreakNode(node)) return '<br>';
  const children = 'getChildren' in node ? (node as ElementNode).getChildren().map(richInline).join('') : '';
  if ($isLinkNode(node)) return `<a${node instanceof ButtonLinkNode ? ' class="weava-link-button"' : ''} href="${escapeWritingHtml(node.getURL())}">${children}</a>`;
  return mediaMarkdown(node) ?? children;
}
function blockContent(node: ElementNode, traverse: (node: ElementNode) => string) {
  return writingDescendants(node).some(extendedText) ? richChildren(node, traverse) : traverse(node);
}
function richChildren(node: ElementNode, traverse: (node: ElementNode) => string): string {
  return node.getChildren().map(child => nestedBlock.export!(child, traverse, () => '') ?? richInline(child)).join('');
}
function detailsMarkdown(node: DetailsNode): string {return `<details class="weava-details"><summary>${escapeWritingHtml(node.getTitle())}</summary>\n\n${$convertToMarkdownString(transformers, node)}\n\n</details>`;}

const writingBlock: Transformer = {
  type: 'element', dependencies: [DetailsNode], regExp: /$^/, replace: () => false,
  export: (node, traverse) => {
    if (node instanceof DetailsNode) return detailsMarkdown(node);
    if ($isParagraphNode(node) || node instanceof HeadingNode || node instanceof QuoteNode) {
      const rich = writingDescendants(node).some(extendedText), aligned = ['center','right','justify'].includes(node.getFormatType());
      if (!rich && !aligned) return null;
      const text = blockContent(node, traverse);
      const content = node instanceof HeadingNode ? '#'.repeat(Number(node.getTag().slice(1))) + ' ' + text
        : node instanceof QuoteNode ? text.split('\n').map(line => '> ' + line).join('\n') : text;
      return aligned ? `<div class="weava-align-${node.getFormatType()}">\n\n${content}\n\n</div>` : content;
    }
    return null;
  },
};
const writingInline: Transformer = {
  type: 'text-match', dependencies: [ButtonLinkNode, FootnoteNode], regExp: /$^/, replace: () => {},
  export: (node, traverse) => node instanceof ButtonLinkNode ? `<a class="weava-link-button" href="${escapeWritingHtml(node.getURL())}">${traverse(node)}</a>`
    : node instanceof FootnoteNode ? `[^${node.getLabel()}]` : null,
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

export const transformers: Transformer[] = [writingBlock, table, codeBlock, mediaBlock, listBlock, writingInline, linkedImage, image, embed, nestedBlock, literalText, ...TRANSFORMERS];

interface MarkdownPart {nodes:LexicalNode[];source:string;notes:[string,string][]}
const markdownParts=new WeakMap<LexicalNode,MarkdownPart>();
const emptyParagraph=(node:LexicalNode)=>{
  if(!$isParagraphNode(node))return false;
  const first=node.getFirstChild();return !first||node.getChildrenSize()===1&&$isTextNode(first)&&/^\s{0,3}$/.test(first.getTextContent());
};
function descendants(nodes:LexicalNode[]){
  const result:LexicalNode[]=[],visit=(node:LexicalNode)=>{result.push(node);if($isElementNode(node))for(const child of node.getChildren())visit(child);};
  for(const node of nodes)visit(node);return result;
}
/** Immutable nodes let unchanged groups reuse their Markdown, including nested edits and footnotes. */
export function exportMarkdown(root: ElementNode = $getRoot()) {
  const children=root.getChildren(),notes=new Map<string,string>(),parts:string[]=[];
  for(let index=0;index<children.length;index+=64){
    const group=children.slice(index,index+64),nodes=descendants(group),previous=markdownParts.get(group[0]);
    let part=previous;
    if(!part||part.nodes.length!==nodes.length||part.nodes.some((node,index)=>node!==nodes[index])){
      // Lexical's public converter reads the supplied root's children. This read-only
      // root view retains its normal conversion rules while limiting work to this group.
      const view=new Proxy(root,{get(target,key,receiver){return key==='getChildren'?()=>group:Reflect.get(target,key,receiver);}});
      part={nodes,source:$convertToMarkdownString(transformers,view),notes:nodes.filter((node):node is FootnoteNode=>node instanceof FootnoteNode).map(node=>[node.getLabel(),node.getSource()])};
      markdownParts.set(group[0],part);
    }
    if(index)parts.push(emptyParagraph(children[index-1])||emptyParagraph(group[0])?'\n':'\n\n');
    parts.push(part.source);for(const [label,body] of part.notes)notes.set(label,body);
  }
  const source=parts.join('');
  for (const [label, body] of Object.entries($getState(root, footnoteOrphans))) if (!notes.has(label)) notes.set(label, body);
  return source + (notes.size ? '\n\n' + [...notes].map(([label, body]) => `[^${label}]: ${body.split('\n').join('\n    ')}`).join('\n\n') : '');
}
