import {createMarkdownParser} from '../../runtime-common/src/markdown.ts';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';
import type { Document, FieldDefinition } from '@weava/contracts';
import { fieldIssues, WeavaError } from '@weava/contracts';
import { createHash } from 'node:crypto';
import { renderCode } from './code-blocks.ts';
import { BoundedCache } from './cache.ts';
const documentCache=new BoundedCache<string,string>(256,16*1024*1024);
const outlineCache=new BoundedCache<string,{html:string;items:{id:string;title:string;level:number}[]}>(256,16*1024*1024);
export const escape = (v: any) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const md = createMarkdownParser();
md.renderer.rules.fence = (tokens, index) => renderCode(tokens[index].content, tokens[index].info);
md.renderer.rules.code_block = (tokens, index) => renderCode(tokens[index].content);
const tableCell = (tagName: string, attrs: Record<string, string>) => {
  const align = attrs.align ?? /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(attrs.style ?? '')?.[1]?.toLowerCase();
  return {tagName, attribs: {...attrs, ...(['left','center','right'].includes(align ?? '') ? {align} : {})}};
};
export function sanitize(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'video',
      'audio',
      'source',
      'track',
      'details',
      'summary',
      'figure',
      'figcaption',
      'span',
      'div',
      'section',
      'button',
      'input',
      'iframe',
    ],
    allowedAttributes: {
      '*': ['id', 'class', 'title', 'aria-*', 'data-*'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
      video: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'playsinline'],
      audio: ['src', 'controls', 'preload'],
      source: ['src', 'type', 'srcset'],
      track: ['src', 'kind', 'srclang', 'label', 'default'],
      iframe: ['src', 'title', 'sandbox', 'loading', 'allowfullscreen'],
      input: ['type', 'checked', 'disabled'],
      ol: ['start'], li: ['value'], td: ['colspan', 'rowspan', 'align'], th: ['colspan', 'rowspan', 'align'],
      button: ['type'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'entry'],
    allowProtocolRelative: false,
    transformTags: {
      td: tableCell,
      th: tableCell,
      a: (tag, attrs) => ({
        tagName: tag,
        attribs: { ...attrs, ...(attrs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) },
      }),
      iframe: (_tag, attrs) => ({
        tagName: 'iframe',
        attribs: { ...attrs, sandbox: 'allow-scripts', loading: 'lazy' },
      }),
    },
  });
}
function lexicalNode(n: any): string {
  const html = lexicalMarkup(n), anchor = n.$?.weavaAnchor;
  return typeof anchor === 'string' && anchor ? html.replace(/^<(\w+)/, `<$1 id="${escape(anchor)}"`) : html;
}
function lexicalMarkup(n: any): string {
  const inner = (n.children ?? []).map(lexicalNode).join('');
  if (n.type === 'text') {
    let s = escape(n.text);
    const f = Number(n.format ?? 0);
    for (const [flag, tag] of [
      [1, 'strong'],
      [2, 'em'],
      [4, 's'],
      [8, 'u'],
      [16, 'code'],
      [32, 'sub'], [64, 'sup'], [128, 'mark'],
    ] as const)
      if (f & flag) s = `<${tag}>${s}</${tag}>`;
    return s;
  }
  switch (n.type) {
    case 'root':
      return inner;
    case 'paragraph':
      return `<p>${inner || '<br>'}</p>`;
    case 'heading':
      return `<${/^h[1-6]$/.test(n.tag) ? n.tag : 'h2'}>${inner}</${/^h[1-6]$/.test(n.tag) ? n.tag : 'h2'}>`;
    case 'linebreak':
      return '<br>';
    case 'quote':
      return `<blockquote>${inner}</blockquote>`;
    case 'list':
      return `<${n.listType === 'number' ? 'ol' : 'ul'}${n.listType === 'number' && n.start > 1 ? ` start="${Number(n.start)}"` : ''}>${inner}</${n.listType === 'number' ? 'ol' : 'ul'}>`;
    case 'listitem':
      return `<li>${inner}</li>`;
    case 'link':
    case 'autolink':
      return `<a href="${escape(n.url)}"${n.target ? ` target="${escape(n.target)}"` : ''}${n.rel ? ` rel="${escape(n.rel)}"` : ''}${n.title ? ` title="${escape(n.title)}"` : ''}>${inner}</a>`;
    case 'code':
      return renderCode((n.children ?? []).map((child: any) => child.type === 'linebreak' ? '\n' : child.type === 'tab' ? '\t' : child.text ?? '').join(''), n.language ?? 'text');
    case 'code-highlight':
      return escape(n.text);
    case 'table':
      return `<table>${inner}</table>`;
    case 'tablerow':
      return `<tr>${inner}</tr>`;
    case 'tablecell':
      return `<${n.headerState ? 'th' : 'td'}${n.colSpan > 1 ? ` colspan="${Number(n.colSpan)}"` : ''}${n.rowSpan > 1 ? ` rowspan="${Number(n.rowSpan)}"` : ''}>${inner}</${n.headerState ? 'th' : 'td'}>`;
    case 'image':
      if (n.kind === 'video')
        return `<figure><video src="${escape(n.src)}" controls preload="metadata"></video>${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
      if (n.kind === 'audio') return `<figure><audio src="${escape(n.src)}" controls preload="metadata"></audio>${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
      if (n.kind === 'file') return `<p><a href="${escape(n.src)}">${escape(n.altText || '下载附件')}</a></p>`;
      return `<figure>${n.href ? `<a href="${escape(n.href)}">` : ''}<img src="${escape(n.src)}" alt="${escape(n.altText)}" loading="lazy">${n.href ? '</a>' : ''}${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
    case 'embed':
      return `<iframe src="${escape(n.src)}" title="${escape(n.title)}"${n.width ? ` width="${escape(n.width)}"` : ''}${n.height ? ` height="${escape(n.height)}"` : ''} allowfullscreen></iframe>`;
    case 'video':
      return `<video src="${escape(n.src)}" controls preload="metadata"></video>`;
    case 'horizontalrule':
      return '<hr>';
    default:
      throw new WeavaError('无法渲染正文节点：' + n.type);
  }
}
export function renderDocument(document: Document): string {
  const key=createHash('sha256').update(JSON.stringify(document)).digest('hex'),cached=documentCache.get(key);if(cached!==undefined)return cached;
  const html = sanitize(
    document.format === 'markdown'
      ? md.render(document.source)
      : document.format === 'html'
        ? document.source
        : lexicalNode(document.source.root),
  );
  const $ = load(html, null, false),
    counts = new Map<string, number>();
  $('h2,h3').each((_i, el) => {
    const h = $(el);
    if (h.attr('id')) return;
    const stem =
      'section-' + createHash('sha256').update(h.text().trim()).digest('hex').slice(0, 12);
    const n = (counts.get(stem) ?? 0) + 1;
    counts.set(stem, n);
    h.attr('id', stem + (n > 1 ? '-' + n : ''));
  });
  const result=$.html();return documentCache.set(key,result,result.length*2);
}
export function plain(html: string) {
  return load('<main>' + html + '</main>')('main')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}
export function articleOutline(html: string) {
  const key=createHash('sha256').update(html).digest('hex'),cached=outlineCache.get(key);
  if(cached)return {html:cached.html,items:cached.items.map(item=>({...item}))};
  const $ = load(html, null, false);
  const seen = new Set<string>($('[id]').filter((_index, element) => !/^h[234]$/.test(element.tagName) || !$(element).text().trim()).map((_index, element) => $(element).attr('id')!).get());
  const items: { id: string; title: string; level: number }[] = [];
  $('h2,h3,h4').each((_index, element) => {
    const node = $(element), title = node.text().trim();
    if (!title) return;
    const base = node.attr('id') || 'section-' + createHash('sha256').update(title).digest('hex').slice(0, 12);
    let id = base, suffix = 2;
    while (seen.has(id)) id = base + '-' + suffix++;
    seen.add(id); node.attr('id', id);
    items.push({ id, title, level: Number(element.tagName.slice(1)) });
  });
  const result={html:$.html(),items};outlineCache.set(key,result,JSON.stringify(result).length*2);
  return {html:result.html,items:items.map(item=>({...item}))};
}
export function tokens(text: string) {
  const lower = text.normalize('NFKC').toLowerCase();
  const base: string[] = Array.from(lower.match(/[a-z0-9_-]+|[\p{Script=Han}]/gu) ?? []);
  const han = lower.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const word of han) for (let i = 0; i < word.length - 1; i++) base.push(word.slice(i, i + 2));
  return [...new Set(base)].join(' ');
}
export function validateFields(defs: FieldDefinition[], values: Record<string, any>, prefix = '', required = true) {
  const errors = fieldIssues(defs, values, { prefix, required });
  if (errors.length) throw new WeavaError(errors.map((error) => error.message).join('；'), 400, errors);
}
