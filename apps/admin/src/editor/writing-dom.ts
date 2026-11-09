import {$isElementNode, $isTextNode, type DOMConversionMap, type LexicalNode} from 'lexical';
import {FootnoteNode} from './WritingNodes.tsx';
import {textColors, highlightColors, patchWritingStyle, type TextColor, type HighlightColor} from '../../../../packages/runtime-common/src/writing-format.ts';

export const writingDOMImport: DOMConversionMap = {
  span: element => {
    if (element.hasAttribute('data-weava-footnote')) return {priority: 4, conversion: () => ({node: new FootnoteNode(element.getAttribute('data-weava-footnote')!, element.getAttribute('data-weava-footnote-source') ?? '')})};
    const color = /(?:^|\s)weava-color-(\w+)(?:\s|$)/.exec(element.className)?.[1] as TextColor | undefined;
    return color && textColors[color] ? {priority: 3, conversion: () => ({node: null, forChild: node => {
      if ($isTextNode(node)) node.setStyle(patchWritingStyle(node.getStyle(), 'color', textColors[color].value));
      return node;
    }})} : null;
  },
  mark: element => {
    const color = /(?:^|\s)weava-highlight-(\w+)(?:\s|$)/.exec(element.className)?.[1] as HighlightColor || 'yellow';
    return {priority: 3, conversion: () => ({node: null, forChild: (node: LexicalNode) => {
      if ($isTextNode(node)) {
        if (!node.hasFormat('highlight')) node.toggleFormat('highlight');
        node.setStyle(patchWritingStyle(node.getStyle(), 'background-color', (highlightColors[color] ?? highlightColors.yellow).value));
      }
      return node;
    }})};
  },
  div: element => {
    const align = /(?:^|\s)weava-align-(center|right|justify)(?:\s|$)/.exec(element.className)?.[1];
    return align ? {priority: 3, conversion: () => ({node: null, forChild: node => {
      if ($isElementNode(node)) node.setFormat(align as 'center' | 'right' | 'justify');
      return node;
    }})} : null;
  },
};
