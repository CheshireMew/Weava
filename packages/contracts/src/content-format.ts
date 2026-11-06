import type {ContentType,Document,Entry} from './index.ts';

export function supportsDiscussion(entry?:Pick<Entry,'kind'|'template'>){return !!entry&&(entry.kind==='content'||entry.kind==='page'&&entry.template==='guestbook');}

export function isNoteType(type?:Pick<ContentType,'id'|'format'>){return type?.format==='note'||!type?.format&&type?.id==='wordpress-moment';}
export function hasNoteContent(document:Document){
 if(document.format==='lexical'){
  const visit=(node:any):boolean=>typeof node?.text==='string'&&!!node.text.trim()||['image','video','audio','file'].includes(node?.type)&&!!node.src||Array.isArray(node?.children)&&node.children.some(visit);
  return visit((document.source as any)?.root);
 }
 const source=String(document.source);
 return /<(img|video|audio|iframe)\b|!\[[^\]]*\]\([^)]+\)/i.test(source)||!!source.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').trim();
}
/** Notes have no required heading field; use their first words in lists and metadata. */
export function noteTitle(document:Document){
 const walk=(node:any):string=>typeof node?.text==='string'?node.text:Array.isArray(node?.children)?node.children.map(walk).join(node.type==='root'?'\n':''):'';
 const text=document.format==='lexical'?walk((document.source as any)?.root):String(document.source).replace(/<[^>]*>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[\s#>*-]+/gm,'').replace(/[*`~]/g,'');
 return [...text.replace(/\s+/g,' ').trim()].slice(0,60).join('')||'未命名笔记';
}
