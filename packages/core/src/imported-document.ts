import { load } from 'cheerio';
import type { Document } from '@weava/contracts';

function emptyParagraph(node: Record<string, any>) {
  return node.type === 'paragraph' && !node.$?.weavaAnchor && (node.children ?? []).every((child: Record<string, any>) =>
    child.type === 'linebreak' || child.type === 'text' && typeof child.text === 'string' && !child.text.replace(/[\s\u200b\ufeff]/g, ''));
}

/** Remove standalone blank paragraphs, retaining code whitespace and the empty editor's insertion point. */
export function withoutEmptyDocumentParagraphs(document: Document): Document {
  if (document.format !== 'lexical') return document;
  const root = document.source.root as Record<string, any> | undefined;
  if (!Array.isArray(root?.children)) return document;
  const children = root.children.filter((node: Record<string, any>) => !emptyParagraph(node));
  if (!children.length || children.length === root.children.length) return document;
  return { ...document, source: { ...document.source, root: { ...root, children } } };
}

/** HTML indentation is not a list item, table row or table cell. */
export function withoutStructuralWhitespace(document: Document): Document {
  if (document.format !== 'lexical') return document;
  const clean = (node: Record<string, any>): Record<string, any> => {
    if (!Array.isArray(node.children)) return node;
    const children = node.children.filter((child: Record<string, any>) =>
      !(['list', 'table', 'tablerow'].includes(node.type) && child.type === 'text' && !child.text?.trim())).map(clean);
    return children.length === node.children.length && children.every((child: any, index: number) => child === node.children[index]) ? node : {...node, children};
  };
  const root = document.source.root as Record<string, any>;
  const result = clean(root);
  return result === root ? document : {...document, source: {...document.source, root: result}};
}

/** This was injected by the old site's theme, separately from authored content. */
export function withoutImportedPromotion(html: string) {
  const $ = load(html, null, false), cards = $('[id^="crypto-card-final-"]');
  if (!cards.length) return html;
  cards.remove();
  return $.html();
}

/** Convert the supported WordPress body into the same editable nodes as new posts.
 * Unknown elements fail explicitly rather than silently dropping their contents. */
export function importedDocument(html: string): Document {
  const $ = load(withoutImportedPromotion(html), null, false);
  $('script,style').remove();
  type Node = Record<string, any>;
  const element = (type: string, children: Node[], extra: Node = {}): Node =>
    ({ type, version: 1, direction: null, format: '', indent: 0, children, ...extra });
  const text = (value: string, format = 0): Node =>
    ({ type: 'text', version: 1, text: value, format, style: '', detail: 0, mode: 'normal' });
  const inlineTypes = new Set(['text', 'link', 'linebreak']);
  const paragraphs = (nodes: Node[]) => {
    const result: Node[] = []; let pending: Node[] = [];
    const flush = () => {
      if (pending.some(node => node.type !== 'text' || node.text.trim())) result.push(element('paragraph', pending, { textFormat: 0, textStyle: '' }));
      pending = [];
    };
    for (const node of nodes) { if (inlineTypes.has(node.type)) pending.push(node); else { flush(); result.push(node); } }
    flush(); return result;
  };
  function convert(node: any, format = 0): Node[] {
    const nodes = convertNode(node, format);
    if (node.attribs?.id && nodes.length) nodes[0].$ = { ...nodes[0].$, weavaAnchor: node.attribs.id };
    return nodes;
  }
  function convertNode(node: any, format = 0): Node[] {
    if (node.type === 'text') return [text(node.data.replace(/\s+/g, ' '), format)];
    if (node.type === 'comment') return [];
    const tag = node.name, attrs = node.attribs ?? {};
    const children = (flags = format): Node[] => (node.children ?? []).flatMap((child: any) => convert(child, flags));
    const flags: Record<string, number> = { strong: 1, b: 1, em: 2, i: 2, del: 4, s: 4, u: 8, code: 16, sub: 32, sup: 64, mark: 128 };
    if (flags[tag]) return children(format | flags[tag]);
    switch (tag) {
      case 'span': return children();
      case 'div': case 'section': case 'article': case 'main': return paragraphs(children());
      case 'p': {
        const content = paragraphs(children());
        if (!content.length && attrs.id) return [element('paragraph', [], { textFormat: 0, textStyle: '' })];
        return content.filter(item => !emptyParagraph(item) || !!attrs.id);
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return [element('heading', children(), { tag })];
      case 'br': return [{ type: 'linebreak', version: 1 }];
      case 'hr': return [{ type: 'horizontalrule', version: 1 }];
      case 'blockquote': return [element('quote', children())];
      case 'a': {
        const content = children();
        // A linked image is a block in the editor; keep its original link.
        const link = (items: Node[]) => element('link', items, { url: attrs.href ?? '', rel: attrs.rel ?? null, target: attrs.target ?? null, title: attrs.title ?? null });
        if (content.every(item => inlineTypes.has(item.type))) return [link(content)];
        return content.flatMap(item => item.type === 'image' ? [{ ...item, href: attrs.href }] : [link([item])]);
      }
      case 'ul': case 'ol': return [element('list', children(), { listType: tag === 'ol' ? 'number' : 'bullet', tag, start: Number(attrs.start) || 1 })];
      case 'li': {
        const siblings = node.parent?.children?.filter((child: any) => child.name === 'li') ?? [];
        return [element('listitem', children(), { value: Number(attrs.value) || (Number(node.parent?.attribs?.start) || 1) + siblings.indexOf(node) })];
      }
      case 'pre': {
        const code = $(node).find('code').first(), language = (code.attr('class') ?? attrs.class ?? '').match(/language-([\w+-]+)/)?.[1] ?? 'text';
        const lines = $(node).text().split('\n'), nodes: Node[] = [];
        lines.forEach((line, index) => { if (index) nodes.push({ type: 'linebreak', version: 1 }); if (line) nodes.push(text(line)); });
        return [element('code', nodes, { language })];
      }
      case 'img': case 'video': case 'audio': return [{ type: 'image', version: 1, src: attrs.src ?? $(node).find('source').first().attr('src') ?? '', altText: attrs.alt ?? '', kind: tag === 'img' ? 'image' : tag, caption: '', ...(attrs.poster ? { poster: attrs.poster } : {}) }];
      case 'figure': {
        const caption = $(node).children('figcaption').text();
        return (node.children ?? []).filter((child: any) => child.name !== 'figcaption').flatMap((child: any) => convert(child, format)).map((item: Node) => item.type === 'image' ? { ...item, caption } : item);
      }
      case 'iframe': return [{ type: 'embed', version: 1, src: attrs.src ?? '', title: attrs.title ?? '嵌入内容', width: attrs.width ?? '', height: attrs.height ?? '' }];
      case 'table': return [element('table', children())];
      case 'thead': case 'tbody': case 'tfoot': return children();
      case 'tr': return [element('tablerow', children())];
      case 'th': case 'td': return [element('tablecell', paragraphs(children()), { headerState: tag === 'th' ? 1 : 0, colSpan: Number(attrs.colspan) || 1, rowSpan: Number(attrs.rowspan) || 1, backgroundColor: null })];
      default: throw new Error('正文中有尚未支持的内容：' + tag);
    }
  }
  const children = paragraphs($.root().contents().toArray().flatMap(node => convert(node)));
  return withoutStructuralWhitespace({ version: 1, format: 'lexical', source: { root: element('root', children.length ? children : [element('paragraph', [], { textFormat: 0, textStyle: '' })]) } });
}
