import type {PublishedEntry} from '@weava/contracts';
import {escape} from './documents.ts';
import {htmlSearchText} from './content-text.ts';
export function searchPresentation(entry: PublishedEntry, query: string) {
  const words = [...new Set(query.normalize('NFKC').trim().split(/\s+/u).filter(Boolean))].sort((a,b)=>b.length-a.length).slice(0,20);
  const pattern = words.length ? new RegExp(words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'giu') : null;
  const highlight = (value: string) => {
    if (!pattern) return escape(value);
    let result = '', offset = 0;
    for (const match of value.matchAll(pattern)) {result += escape(value.slice(offset,match.index))+'<mark>'+escape(match[0])+'</mark>'; offset=match.index!+match[0].length;}
    return result + escape(value.slice(offset));
  };
  const text = htmlSearchText(entry.html ?? '').replace(/\s+/g,' ').normalize('NFKC');
  const first = pattern ? text.search(pattern) : -1;
  const start = Math.max(0,first-65), snippet = (start?'…':'')+text.slice(start,start+220)+(text.length>start+220?'…':'');
  return {title:highlight(entry.title),snippet:highlight(snippet || entry.description)};
}
