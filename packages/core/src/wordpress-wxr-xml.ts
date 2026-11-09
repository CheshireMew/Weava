import { WeavaError } from '@weava/contracts';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import sax from 'sax';
import { digest } from '../../runtime-common/src/identity.ts';
import { plain } from './documents.ts';
import { digestFile } from './file-io.ts';
export interface Xml {
  name: string;
  text: string;
  attrs: Record<string, string>;
  children: Xml[];
}
export type WxrInput = string | { file: string; sha256?: string };
export const wxrDigest = (source: WxrInput) =>
  typeof source === 'string' ? digest(source) : source.sha256 ?? digestFile(source.file);
export function parseXml(source: WxrInput, acceptItem?: (node: Xml) => void) {
  if (
    (typeof source === 'string' ? Buffer.byteLength(source) : statSync(source.file).size) >
    128 * 1024 * 1024
  )
    throw new WeavaError('WXR 文件超过 128 MB，请在 WordPress 分批导出。');
  const root: Xml = { name: '#document', text: '', attrs: {}, children: [] },
    stack = [root];
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  parser.onopentag = (tag) => {
    const prefix = /wordpress\.org\/export\/1\.[012]\/?$/.test(tag.uri)
      ? 'wp:'
      : tag.uri === 'http://purl.org/rss/1.0/modules/content/'
        ? 'content:'
        : tag.uri === 'http://wordpress.org/export/1.2/excerpt/' ||
            /wordpress\.org\/export\/1\.[012]\/excerpt\//.test(tag.uri)
          ? 'excerpt:'
          : tag.uri === 'http://purl.org/dc/elements/1.1/'
            ? 'dc:'
            : '';
    const node: Xml = {
      name: prefix + tag.local,
      text: '',
      children: [],
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((attr) => [attr.local, attr.value]),
      ),
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  };
  parser.onclosetag = () => {
    const node = stack.pop()!;
    if (node.name === 'item' && stack.at(-1)?.name === 'channel' && acceptItem) {
      acceptItem(node);
      stack.at(-1)!.children.pop();
    }
  };
  parser.ontext = parser.oncdata = (text) => {
    stack.at(-1)!.text += text;
  };
  parser.ondoctype = () => {
    throw new WeavaError('WXR 不需要 DTD，请使用 WordPress 的标准导出文件。');
  };
  parser.onerror = (error) => {
    throw new WeavaError('WXR XML 不完整或格式无效：' + error.message);
  };
  if (typeof source === 'string') parser.write(source.replace(/^\ufeff/, '')).close();
  else {
    const file = openSync(source.file, 'r'),
      buffer = Buffer.allocUnsafe(65536),
      decoder = new StringDecoder('utf8');
    let first = true;
    try {
      for (;;) {
        const length = readSync(file, buffer, 0, buffer.length, null);
        if (!length) break;
        let chunk = decoder.write(buffer.subarray(0, length));
        if (first) {
          chunk = chunk.replace(/^\ufeff/, '');
          first = false;
        }
        parser.write(chunk);
      }
      parser.write(decoder.end()).close();
    } finally {
      closeSync(file);
    }
  }
  const rss = root.children.find((node) => node.name === 'rss'),
    channel = rss?.children.find((node) => node.name === 'channel');
  if (!channel || !['1.0', '1.1', '1.2'].includes(text(channel, 'wp:wxr_version')))
    throw new WeavaError('这不是受支持的 WordPress WXR 导出文件。');
  return channel;
}
export const children = (node: Xml, name: string) =>
  node.children.filter((child) => child.name === name);
export const text = (node: Xml, name: string) => children(node, name)[0]?.text ?? '';
export const titleText = (value: string) => plain(value).trim();
export interface Item {
  id: string;
  type: string;
  title: string;
  url: string;
  slug: string;
  parent: string;
  status: string;
  body: string;
  excerpt: string;
  creator: string;
  date?: string;
  modified?: string;
  password: boolean;
  media: string;
  meta: Record<string, string[]>;
  taxonomies: { kind: string; slug: string; label: string }[];
  comments: Xml[];
}
export const date = (gmt: string, fallback = '') => {
  const value = gmt && !gmt.startsWith('0000-') ? gmt.replace(' ', 'T') + 'Z' : fallback;
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
};
export function itemFromXml(node: Xml): Item {
  const meta: Record<string, string[]> = {};
  for (const item of children(node, 'wp:postmeta'))
    (meta[text(item, 'wp:meta_key')] ??= []).push(text(item, 'wp:meta_value'));
  return {
    id: text(node, 'wp:post_id'),
    type: text(node, 'wp:post_type') || 'post',
    title: titleText(text(node, 'title')),
    url: text(node, 'link'),
    slug: text(node, 'wp:post_name'),
    parent: text(node, 'wp:post_parent'),
    status: text(node, 'wp:status'),
    body: text(node, 'content:encoded'),
    excerpt: text(node, 'excerpt:encoded'),
    creator: text(node, 'dc:creator'),
    date: date(text(node, 'wp:post_date_gmt'), text(node, 'pubDate')),
    modified: date(text(node, 'wp:post_modified_gmt')),
    password: !!text(node, 'wp:post_password'),
    media: text(node, 'wp:attachment_url'),
    meta,
    taxonomies: children(node, 'category').map((term) => ({
      kind: term.attrs.domain ?? '',
      slug: term.attrs.nicename ?? '',
      label: titleText(term.text),
    })),
    comments: children(node, 'wp:comment'),
  };
}
