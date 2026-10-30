import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';
import type { Document, FieldDefinition } from '@weava/contracts';
import { fieldIssues, WeavaError } from '@weava/contracts';
import { createHash } from 'node:crypto';
import { renderCode } from './code-blocks.ts';
export const escape = (v: any) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
md.renderer.rules.fence = (tokens, index) => renderCode(tokens[index].content, tokens[index].info);
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
      button: ['type'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'entry'],
    allowProtocolRelative: false,
    transformTags: {
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
      return `<${n.listType === 'number' ? 'ol' : 'ul'}>${inner}</${n.listType === 'number' ? 'ol' : 'ul'}>`;
    case 'listitem':
      return `<li>${inner}</li>`;
    case 'link':
    case 'autolink':
      return `<a href="${escape(n.url)}">${inner}</a>`;
    case 'code':
      return renderCode((n.children ?? []).map((child: any) => child.type === 'linebreak' ? '\n' : child.type === 'tab' ? '\t' : child.text ?? '').join(''), n.language ?? 'text');
    case 'code-highlight':
      return escape(n.text);
    case 'table':
      return `<table>${inner}</table>`;
    case 'tablerow':
      return `<tr>${inner}</tr>`;
    case 'tablecell':
      return `<${n.headerState ? 'th' : 'td'}>${inner}</${n.headerState ? 'th' : 'td'}>`;
    case 'image':
      if (n.kind === 'video')
        return `<figure><video src="${escape(n.src)}" controls preload="metadata"></video>${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
      if (n.kind === 'audio') return `<figure><audio src="${escape(n.src)}" controls preload="metadata"></audio>${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
      if (n.kind === 'file') return `<p><a href="${escape(n.src)}">${escape(n.altText || '下载附件')}</a></p>`;
      return `<figure><img src="${escape(n.src)}" alt="${escape(n.altText)}" loading="lazy">${n.caption ? `<figcaption>${escape(n.caption)}</figcaption>` : ''}</figure>`;
    case 'video':
      return `<video src="${escape(n.src)}" controls preload="metadata"></video>`;
    case 'horizontalrule':
      return '<hr>';
    default:
      throw new WeavaError('无法渲染正文节点：' + n.type);
  }
}
export function renderDocument(document: Document): string {
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
  return $.html();
}
export function plain(html: string) {
  return load('<main>' + html + '</main>')('main')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}
export function articleOutline(html: string) {
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
  return { html: $.html(), items };
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
