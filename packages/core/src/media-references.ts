import type { Entry, Release } from '@weava/contracts';
import { mediaIdentity } from './paths.ts';
import { referencedLayouts } from './layouts.ts';
import { load } from 'cheerio';
import { visitMarkdown } from './document-inspection.ts';

/** One file identity for authored URLs, rendered HTML, history and usage reports. */
export function mediaReferencesIn(value: unknown): Set<string> {
  const paths = new Set<string>();
  const add = (value: string) => {
    try {
      // Resolve dot segments, spaces and URL escapes as a browser does before authorization.
      const url = new URL(value, 'https://weava.invalid/');
      if (/^\/media\//i.test(url.pathname)) paths.add(mediaIdentity(url.pathname));
    } catch { /* Invalid addresses cannot identify a served file. */ }
  };
  const scan = (text: string) => {
    if (/^(?:https?:\/\/[^/]+)?\/media\/[^<>"\r\n]+$/i.test(text.trim())) { add(text.trim()); return; }
    for (const match of text.matchAll(/\/media\/[^"'<>\\\s)\]}]+/gi)) add(match[0]);
  };
  const html = (source: string) => {
    const $ = load(source, null, false);
    scan($.root().text());
    $('*').each((_index, element) => {
      if('attribs' in element) for (const [name,value] of Object.entries(element.attribs)) {
        if(name==='srcset') {
          // URLs in srcset may contain parentheses and commas. Descriptors are not part of the URL.
          let at=0;
          while(at<value.length) {
            while(at<value.length && /[\t\n\f\r ,]/.test(value[at]))at++;
            const start=at;while(at<value.length && !/[\t\n\f\r ]/.test(value[at]))at++;
            const url=value.slice(start,at);add(url.replace(/,+$/,''));
            if(url.endsWith(','))continue;
            let brackets=0;
            while(at<value.length) {const char=value[at++];if(char==='(')brackets++;else if(char===')')brackets=Math.max(0,brackets-1);else if(char===','&&!brackets)break;}
          }
        } else scan(value);
      }
    });
  };
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      if(item.includes('](')||item.includes(']:')) {visitMarkdown(item, token => {
        // Markdown-it also uses numeric attributes, such as an ordered list's start.
        for (const [, value] of token.attrs ?? []) if(typeof value==='string')scan(value);
        if (token.type === 'html_inline' || token.type === 'html_block') html(token.content);
        else if (!token.children?.length) scan(token.content);
      });return;}
      if (/[<&]/.test(item)) {
        // Parse mixed Markdown before HTML so an ampersand does not hide image destinations.
        html(item);
        return;
      }
      scan(item);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return paths;
}

export function entryMediaReferences(
  entry: Entry,
  catalog?: Pick<Release, 'settings' | 'types' | 'layouts'>,
) {
  return mediaReferencesIn([
    entry.cover,
    entry.blocks?.length ? null : entry.document,
    entry.blocks,
    entry.fields,
    catalog ? referencedLayouts(entry, catalog) : [],
  ]);
}
