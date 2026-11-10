import {load} from 'cheerio';
import {createMarkdownParser} from '../../runtime-common/src/markdown.ts';
import type {Document, Block} from '@weava/contracts';
const parser = createMarkdownParser();
export const htmlSearchText = (html: string) => {const document = load(html, null, false); document('script,style,[data-copy-code]').remove(); return document.root().text();};
export function documentText(document: Document): string {
  if (document.format === 'html') return htmlSearchText(document.source);
  if (document.format === 'markdown') return htmlSearchText(parser.render(document.source));
  const visit = (node: any): string => [node.text ?? '', node.altText ?? '', ...(node.children ?? []).map(visit)].join(' ');
  return visit(document.source.root);
}
export function blockSearchText(blocks: Block[]): string {
  const strings = (value: unknown): string => typeof value === 'string' ? htmlSearchText(value) : Array.isArray(value) ? value.map(strings).join(' ') : value && typeof value === 'object' ? Object.values(value).map(strings).join(' ') : '';
  return blocks.map(block => strings(block.props) + ' ' + blockSearchText(block.children ?? [])).join(' ');
}
