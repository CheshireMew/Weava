import {existsSync,readdirSync,lstatSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,constants,realpathSync,statfsSync} from 'node:fs';
import {join,resolve,relative,dirname,basename,extname} from 'node:path';
import {parse as parseYaml,stringify as stringifyYaml} from 'yaml';
import {load} from 'cheerio';
import {entrySchema,isUploadFormat,type Entry,WeavaError,type Release} from '@weava/contracts';
import {createMarkdownParser} from '../../runtime-common/src/markdown.ts';
import {digest} from '../../runtime-common/src/identity.ts';
import {digestFile} from './file-io.ts';
import {mediaReferencesIn} from './media-references.ts';
import {renderDocument} from './documents.ts';
import {renderBlocks} from './render.ts';
import {exportSite,importSite,importRevisions,type SiteExchange} from './exchange.ts';
import {replaceMediaUrls} from './media-replacement.ts';
import {prepareMedia,queueMediaOptimization,validateMediaFile} from './media.ts';
import {assertUploadSize} from './media-upload-policy.ts';
import {pathWithin} from './paths.ts';
import {inside} from '../../runtime-common/src/paths.ts';
import type {Site} from './site.ts';
const parser=createMarkdownParser();
const marker='weava-markdown.json';
interface FolderManifest {version:1;site:SiteExchange;media:{url:string;file:string;hash:string}[]}
export function parseMarkdownFile(source:string){
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const metadata=match?parseYaml(match[1],{maxAliasCount:50}):{};
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new WeavaError('Markdown 文件头需要是键值对象。');
  return {metadata,body:source.slice(match?.[0].length??0)};
}
export function markdownFile(entry:Entry,body:string){
  const {document,...metadata}=entry;
  const weava=document.format!=='markdown'||entry.blocks.length?{bodyHash:digest(body),document}:undefined;
  return '---\n'+stringifyYaml({...metadata,...(weava?{weava}:{})},{lineWidth:0})+'---\n'+body;
}
function filesIn(root:string):string[]{
  const result:string[]=[];
  function visit(folder:string){for(const row of readdirSync(folder,{withFileTypes:true})){if(row.name==='.git'||row.name==='node_modules')continue;const path=join(folder,row.name),info=lstatSync(path);if(info.isSymbolicLink())continue;if(info.isDirectory())visit(path);else if(info.isFile()&&/\.(md|markdown)$/i.test(row.name))result.push(path);if(result.length>10000)throw new WeavaError('每次最多处理 10,000 个 Markdown 文件。');}}
  visit(root);return result.sort();
}
function localFile(root:string,path:string){
  if(!pathWithin(root,path)||!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||!pathWithin(realpathSync(root),realpathSync(path)))throw new WeavaError('附件不存在或不在导入目录内：'+relative(root,path));
  return path;
}
function portable<T>(value:T,media:{url:string;file:string}[],domain:string,toFolder:boolean){
  let current=value;
  for(const item of media)current=replaceMediaUrls(current,toFolder?item.url:'../'+item.file,toFolder?'../'+item.file:item.url,domain).value;
  return current;
}
export function exportMarkdownFolder(site:Site,output:string,budgetBytes=1024*1024*1024){
  const root=resolve(output);
  if(pathWithin(site.root,root))throw new WeavaError('导出目录必须位于站点之外。');
  if(existsSync(root)&&readdirSync(root).length)throw new WeavaError('请使用新的或空的导出目录，未覆盖现有文件。');
  const exchange=exportSite(site),references=mediaReferencesIn(exchange),media=[...references].sort().map(url=>{const file=url.slice(1),path=localFile(site.root,inside(site.root,file));return {url,file,path,hash:digestFile(path),bytes:lstatSync(path).size};});
  const originals=exchange.entries as Entry[],release:Release={id:'markdown-export',createdAt:new Date().toISOString(),label:'Markdown',settings:exchange.settings,types:exchange.types,terms:exchange.terms,layouts:exchange.layouts,entries:originals.map(entry=>({...entry,html:renderDocument(entry.document),revisionId:site.store.get('entry',entry.id)!.revision,modifiedAt:entry.updatedAt??''}))};
  const documents=originals.map(entry=>{const body=entry.blocks.length?renderBlocks(entry.blocks,release,entry,site.blockRenderers):entry.document.format==='markdown'?entry.document.source:renderDocument(entry.document);return {file:'entry-'+digest(entry.id).slice(0,24)+'.md',source:markdownFile(portable(entry,media,exchange.settings.domain,true),portable(body,media,exchange.settings.domain,true))};});
  const bytes=media.reduce((sum,item)=>sum+item.bytes,0)+documents.reduce((sum,item)=>sum+Buffer.byteLength(item.source),0);
  if(bytes>budgetBytes)throw new WeavaError('预计导出 '+Math.ceil(bytes/1048576)+' MB，超过本次体积预算；请明确提高 --budget-mib。');
  let ancestor=dirname(root);while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)throw new WeavaError('导出磁盘不存在。');ancestor=parent;}const disk=statfsSync(ancestor);if(disk.bavail*disk.bsize<bytes+64*1048576)throw new WeavaError('导出磁盘空间不足。');
  mkdirSync(join(root,'content'),{recursive:true});
  for(const item of media){const target=inside(root,item.file);mkdirSync(dirname(target),{recursive:true});copyFileSync(item.path,target,constants.COPYFILE_EXCL);}
  for(const item of documents)writeFileSync(join(root,'content',item.file),item.source,{flag:'wx'});
  const {entries:_entries,...siteMetadata}=exchange;
  const manifest:FolderManifest={version:1,site:siteMetadata,media:media.map(({url,file,hash})=>({url,file,hash}))};
  writeFileSync(join(root,marker),JSON.stringify(manifest,null,2),{flag:'wx'});
  return {path:root,entries:documents.length,media:media.length,bytes};
}
export interface FolderOptions {type?:string;merge?:boolean;settings?:boolean;review?:string;budgetBytes?:number}
interface SelectedMarkdown {name:string;file:string}
function planFolder(site:Site,input:string,options:FolderOptions,selected?:SelectedMarkdown){
  const root=resolve(input);
  const paths=selected?[inside(root,selected.name)]:filesIn(root);
  if(!paths.length)throw new WeavaError('目录里没有 Markdown 文件。');
  const manifest:FolderManifest|undefined=!selected&&existsSync(join(root,marker))?JSON.parse(readFileSync(join(root,marker),'utf8')):undefined;
  if(manifest&&manifest.version!==1)throw new WeavaError('Markdown 目录版本不受支持。');
  const domain=site.settings().value.domain,attachments=new Map<string,{path:string;name:string;hash:string;url:string;bytes:number;legacySvg:boolean}>();
  let bytes=0;
  const mappings:{from:string;to:string}[]=[];
  const attachment=(file:string,fromManifest=false)=>{
    if(selected)throw new WeavaError('此文件引用了本地附件 '+basename(file)+'。可上传附件后换成站内链接，或通过 Markdown 目录导入一起迁移。');
    localFile(root,file);const previous=attachments.get(file);if(previous)return previous;
    const size=lstatSync(file).size;assertUploadSize(site,basename(file),size);
    const legacySvg=fromManifest&&extname(file).toLowerCase()==='.svg';
    if(legacySvg){const svg=load(readFileSync(file,'utf8'),{xmlMode:true});if(svg.root().children().length!==1||svg.root().children().first().prop('tagName')?.toLowerCase()!=='svg')throw new WeavaError('导出目录中的 SVG 无效。');}else validateMediaFile(file,basename(file),size);
    const hash=digestFile(file),existing=site.store.get('media',hash.slice(0,24)),item={path:file,name:basename(file),hash,url:existing?.value.url??'/media/'+hash.slice(0,24)+extname(file).toLowerCase(),bytes:size,legacySvg};
    attachments.set(file,item);bytes+=size;return item;
  };
  if(manifest)for(const item of manifest.media){const file=localFile(root,inside(root,item.file)),selected=attachment(file,true);if(selected.hash!==item.hash)throw new WeavaError('导出附件校验失败：'+item.file);mappings.push({from:item.url,to:selected.url},{from:'../'+item.file,to:selected.url});}
  const records=paths.map(path=>{
    const file=selected?.file??path,size=lstatSync(file).size;
    if(size>32*1048576)throw new WeavaError('单篇 Markdown 文件超过 32 MB：'+relative(root,path));
    bytes+=size;
    let source:string;
    try{source=selected?new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file)):readFileSync(file,'utf8');}
    catch(error){if(error instanceof TypeError)throw new WeavaError('Markdown 文件需要使用 UTF-8 编码。');throw error;}
    const {metadata,body}=parseMarkdownFile(source);
    return {path,metadata,body,id:String(metadata.id??'md-'+digest(relative(root,path).replaceAll('\\','/')).slice(0,24)),hash:digest(source)};
  });
  const byPath=new Map(records.map(item=>[resolve(item.path),item.id]));
  const entries=records.map(item=>{
    let source=item.body;const metadata=structuredClone(item.metadata),urls=new Set<string>();
    const visit=(tokens:ReturnType<typeof parser.parse>)=>{for(const token of tokens){if(token.type==='image'||token.type==='link_open'){const url=token.attrGet(token.type==='image'?'src':'href');if(url)urls.add(url);}if(token.type==='html_inline'||token.type==='html_block'){const document=load(token.content,null,false);document('[src],[href],[poster]').each((_i,node)=>{for(const attribute of ['src','href','poster']){const value=document(node).attr(attribute);if(value)urls.add(value);}});}if(token.children)visit(token.children);}};
    visit(parser.parse(source,{}));if(typeof metadata.cover==='string')urls.add(metadata.cover);
    for(const url of urls){if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url))continue;const separator=url.search(/[?#]/),plain=separator<0?url:url.slice(0,separator),suffix=separator<0?'':url.slice(separator);
      let file:string;try{file=plain.startsWith('/')?inside(root,decodeURIComponent(plain).slice(1)):resolve(dirname(item.path),decodeURIComponent(plain));}catch{throw new WeavaError('附件路径编码无效：'+url);}
      // Framework images and existing site-root links are URLs, not absolute disk paths.
      if(plain.startsWith('/')&&(selected||!plain.startsWith('/media/')&&!existsSync(file)))continue;
      if(byPath.has(file)){source=replaceMediaUrls(source,url,'entry:'+encodeURIComponent(byPath.get(file)!)+suffix,domain).value;continue;}
      if(!isUploadFormat(file))continue;
      if(plain.startsWith('/media/'))file=inside(root,plain.slice(1));
      const target=attachment(file).url;
      source=replaceMediaUrls(source,url,target+suffix,domain).value;
      Object.assign(metadata,replaceMediaUrls(metadata,url,target+suffix,domain).value);
    }
    if(manifest)for(const mapping of mappings){source=replaceMediaUrls(source,mapping.from,mapping.to,domain).value;Object.assign(metadata,replaceMediaUrls(metadata,mapping.from,mapping.to,domain).value);}
    const {weava,...fields}=metadata;
    const originalUnchanged=weava?.bodyHash===digest(item.body);
    return entrySchema.parse({...fields,id:item.id,kind:metadata.kind??'content',type:options.type??metadata.type??'post',title:metadata.title??/^#\s+(.+)$/m.exec(source)?.[1]??basename(item.path,extname(item.path)),path:metadata.path??'/posts/'+encodeURIComponent(item.id)+'/',status:selected?'draft':metadata.status??'draft',blocks:originalUnchanged?metadata.blocks??[]:[],document:originalUnchanged&&weava?.document?weava.document:{version:1,format:'markdown',source}});
  });
  if(bytes>(options.budgetBytes??1024*1024*1024))throw new WeavaError('预计处理 '+Math.ceil(bytes/1048576)+' MB，超过本次体积预算；请明确提高 --budget-mib。');
  const exchange:SiteExchange={...(manifest?.site??{version:1}),entries};
  if(manifest)for(const mapping of mappings)Object.assign(exchange,replaceMediaUrls(exchange,mapping.from,mapping.to,domain).value);
  if(!options.settings)delete exchange.settings;
  if(!exchange.types)exchange.types=[...new Set(entries.filter(entry=>entry.kind==='content').map(entry=>entry.type))].filter(id=>!site.store.get('type',id)).map(id=>({id,label:id,pathPrefix:'/posts/',template:'article',fields:[]}));
  const revisions=importRevisions(site),mode=options.merge?'merge' as const:'create' as const;
  const review=digest({files:records.map(item=>[relative(root,item.path),item.hash]),manifest,attachments:[...attachments.values()],revisions,mode,settings:!!options.settings,type:options.type});
  return {root,exchange,attachments:[...attachments.values()],bytes,revisions,mode,review,entries:entries.map(entry=>({id:entry.id,title:entry.title,path:entry.path}))};
}
export function previewMarkdownFolder(site:Site,input:string,options:FolderOptions={}){
  const plan=planFolder(site,input,options);const result=importSite(site,plan.exchange,{dryRun:true,mode:plan.mode,revisions:plan.revisions});
  return {review:plan.review,entries:plan.entries,media:plan.attachments.length,bytes:plan.bytes,result};
}
export async function importMarkdownFolder(site:Site,input:string,options:FolderOptions){
  const plan=planFolder(site,input,options);
  if(!options.review||options.review!==plan.review)throw new WeavaError('目录、选项或站点已变化，请重新预检。',409);
  importSite(site,plan.exchange,{dryRun:true,mode:plan.mode,revisions:plan.revisions});
  const prepared: Awaited<ReturnType<typeof prepareMedia>>[]=[];
  for(const item of plan.attachments){
    if(item.legacySvg){const destination=inside(site.root,item.url.slice(1));mkdirSync(dirname(destination),{recursive:true});if(!existsSync(destination))copyFileSync(item.path,destination,constants.COPYFILE_EXCL);const id=item.hash.slice(0,24);prepared.push({id,revision:site.store.get('media',id)?.revision??null,value:{id,name:item.name,url:item.url,bytes:item.bytes,hash:item.hash,width:undefined,height:undefined,derivatives:[]}});}
    else prepared.push(await prepareMedia(site,item.path,item.name,{hash:item.hash,optimize:false}));
    if(digestFile(inside(site.root,prepared.at(-1)!.value.url.slice(1)))!==item.hash)throw new WeavaError('准备期间附件已变化，请重新预检。',409);
  }
  return site.store.raw.transaction(()=>{
    if(digest(importRevisions(site))!==digest(plan.revisions))throw new WeavaError('准备附件期间站点已变化，请重新预检。',409);
    for(const item of prepared)if(!site.store.get('media',item.id))site.store.put('media',item.id,item.value,null,'Markdown 附件');
    const result=importSite(site,plan.exchange,{mode:plan.mode,revisions:plan.revisions});for(const item of prepared)queueMediaOptimization(site,item.id);
    return {review:plan.review,result,media:prepared.length,entries:plan.entries};
  }).immediate();
}
export function importSelectedMarkdown(site:Site,selected:SelectedMarkdown,options:{mode?:'create'|'merge';dryRun?:boolean;markdownReview?:string},committed?:(result:any)=>void){
  const plan=planFolder(site,join(site.root,'imports'),{merge:options.mode==='merge'},selected);
  const describe=(result:ReturnType<typeof importSite>)=>({...result,markdownReview:plan.review,entry:plan.entries[0]});
  if(options.dryRun)return describe(importSite(site,plan.exchange,{dryRun:true,mode:plan.mode,revisions:plan.revisions}));
  return site.store.raw.transaction(()=>{
    if(!options.markdownReview||options.markdownReview!==plan.review||digest(importRevisions(site))!==digest(plan.revisions))
      throw new WeavaError('文件、导入选项或站点内容已变化，请重新预检。',409);
    const result=describe(importSite(site,plan.exchange,{mode:plan.mode,revisions:plan.revisions}));
    committed?.(result);
    return result;
  }).immediate();
}
