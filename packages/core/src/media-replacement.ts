import {WeavaError,mediaKind,type Entry} from '@weava/contracts';
import type {Site} from './site.ts';
import {digest} from '../../runtime-common/src/identity.ts';
import {markdownTokens} from './document-inspection.ts';
export interface MediaReplacementInput {fromId:string;toId:string;ids?:string[];review?:string}
export function replaceMediaUrls<T>(value:T,from:string,to:string,domain:string):{value:T;count:number}{
  let count=0;
  const variants=new Set([from,encodeURI(decodeURI(from)),new URL(from,domain).href]);
  const escaped=[...variants].sort((a,b)=>b.length-a.length).map(path=>path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const pattern=new RegExp('(^|[\\s("\'<>=,\\[{])('+escaped+')(?=$|[\\s)"\'<>\\]?#},])','g');
  const replace=(text:string)=>text.replace(pattern,(_match,prefix)=>{count++;return prefix+to;});
  const replaceText=(text:string)=>{
    // Code examples are authored text, rather than live media destinations.
    const ranges:[number,number][]=[];
    const starts=[0];for(let at=0;at<text.length;at++)if(text[at]==='\n')starts.push(at+1);
    for(const token of markdownTokens(text))if((token.type==='fence'||token.type==='code_block')&&token.map)ranges.push([starts[token.map[0]],starts[token.map[1]]??text.length]);
    for(const match of text.matchAll(/<(?<tag>pre|code)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>|(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/gi))ranges.push([match.index!,match.index!+match[0].length]);
    ranges.sort((a,b)=>a[0]-b[0]);let at=0,result='';
    for(const [start,end] of ranges){if(end<=at)continue;result+=replace(text.slice(at,Math.max(at,start)))+text.slice(Math.max(at,start),end);at=end;}
    return result+replace(text.slice(at));
  };
  const visit=(item:any):any=>typeof item==='string'?replaceText(item):Array.isArray(item)?item.map(visit):item&&typeof item==='object'?['code','code-highlight'].includes(item.type)?item:Object.fromEntries(Object.entries(item).map(([key,value])=>[key,visit(value)])):item;
  return {value:visit(value),count};
}
function prepare(site:Site,input:MediaReplacementInput){
  const from=site.store.get('media',input.fromId),to=site.store.get('media',input.toId);
  if(!from||!to||to.value.archived)throw new WeavaError('请选择存在且未归档的替换媒体。');
  if(from.id===to.id||mediaKind(from.value.url)!==mediaKind(to.value.url))throw new WeavaError('新媒体必须与原媒体类型相同，且不能是同一个文件。');
  if(input.ids&&(!input.ids.length||input.ids.length>200||new Set(input.ids).size!==input.ids.length))throw new WeavaError('每次最多替换 200 篇不同内容。');
  const ids=input.ids??(site.store.raw.prepare("SELECT DISTINCT id FROM authored_media_refs WHERE scope='entry' AND path=? ORDER BY id LIMIT 201").all(from.value.url) as {id:string}[]).map(row=>row.id);
  if(ids.length>200)throw new WeavaError('引用超过 200 篇，请通过 ids 分批选择。');
  const rows=ids.map(id=>{const row=site.store.get('entry',id);if(!row)throw new WeavaError('待替换内容不存在，请重新预检。',409,{id});return row;});
  const changes=rows.flatMap(row=>{
    const {cover,document,blocks,fields,seo}=row.value as Entry;
    const replacement=replaceMediaUrls({cover,document,blocks,fields,seo},from.value.url,to.value.url,site.settings().value.domain);
    return replacement.count?[{row,count:replacement.count,value:{...row.value,...replacement.value} as Entry}]:[];
  });
  const review=digest({from:{id:from.id,revision:from.revision},to:{id:to.id,revision:to.revision},ids:input.ids??null,changes:changes.map(item=>[item.row.id,item.row.revision,item.value])});
  return {review,changes,from:from.value.url,to:to.value.url};
}
export function previewMediaReplacement(site:Site,input:MediaReplacementInput){
  const prepared=prepare(site,input);
  return {review:prepared.review,from:prepared.from,to:prepared.to,items:prepared.changes.map(item=>({id:item.row.id,revision:item.row.revision,title:item.row.value.title,path:item.row.value.path,count:item.count}))};
}
export function applyMediaReplacement(site:Site,input:MediaReplacementInput){
  return site.store.raw.transaction(()=>{
    if(input.review){const existing=site.store.get('media-replacement',input.review);if(existing)return existing.value as {items:{id:string;revision:number;title:string}[]};}
    const prepared=prepare(site,input);
    if(!input.review||input.review!==prepared.review)throw new WeavaError('媒体、引用或工作稿已变化，请重新预检。',409);
    const candidates=prepared.changes.map(item=>item.value);
    const saved=prepared.changes.map(item=>site.saveEntry(item.value,item.row.revision,{references:candidates}));
    const result={items:saved.map(row=>({id:row.id,revision:row.revision,title:row.value.title}))};
    site.store.put('media-replacement',input.review,result,null,'替换媒体引用');
    return result;
  }).immediate();
}
