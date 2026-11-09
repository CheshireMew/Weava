import { createMarkdownParser } from '../../runtime-common/src/markdown.ts';
import { load } from 'cheerio';
import { WeavaError, type Document } from '@weava/contracts';
import { BoundedCache } from './cache.ts';

const markdown = createMarkdownParser();
type Token = ReturnType<typeof markdown.parse>[number];
const parsed = new BoundedCache<string, Token[]>(64, 8 * 1024 * 1024);
export function markdownTokens(source: string): Token[] {
  const known = parsed.get(source);
  if (known) return known;
  return parsed.set(source, markdown.parse(source, {}), Math.max(256, source.length * 8));
}
export function visitMarkdown(source: string, visit: (token: Token) => void) {
  const walk = (tokens: Token[]) => { for (const token of tokens) { visit(token); if (token.children) walk(token.children); } };
  walk(markdownTokens(source));
}
const lexicalTypes = new Set(['root','paragraph','heading','linebreak','quote','list','listitem','link','autolink','code','code-highlight','table','tablerow','tablecell','image','embed','video','horizontalrule','text','tab','writing-button','writing-details','writing-footnote']);
/** Draft checks inspect structure; syntax highlighting and HTML generation belong to rendering. */
export function checkDocumentStructure(document: Document) {
  if (document.format !== 'lexical') return;
  const visit = (node: any) => {
    if (!node || !lexicalTypes.has(node.type)) throw new WeavaError('无法渲染正文节点：' + node?.type);
    if (node.children !== undefined && !Array.isArray(node.children)) throw new WeavaError('正文节点的子内容无效。');
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.source.root);
}
export function firstDocumentImage(document: Document): string {
  if (document.format === 'html') return load(document.source, null, false)('img[src]').first().attr('src') ?? '';
  if (document.format === 'lexical') {
    const visit = (node: any): string => node.type === 'image' && (!node.kind || node.kind === 'image') ? node.src ?? '' : (node.children ?? []).map(visit).find(Boolean) ?? '';
    return visit(document.source.root);
  }
  let image = '';
  visitMarkdown(document.source, token => {
    if (image) return;
    if (token.type === 'image') image = token.attrGet('src') ?? '';
    else if (token.type === 'html_inline' || token.type === 'html_block') image = load(token.content, null, false)('img[src]').first().attr('src') ?? '';
  });
  return image;
}
