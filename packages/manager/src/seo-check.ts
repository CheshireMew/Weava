import {load} from 'cheerio';
import {createHash} from 'node:crypto';

const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clean=(value:string)=>value.replace(/\s+/g,' ').trim();
const sorted=(values:string[])=>[...new Set(values)].sort();
const reserved=/^\/(?:api|admin|__preview|__health|_admin|_site|_astro|media)(?:\/|$)/;
const stable=(value:any):any=>Array.isArray(value)?value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export interface SeoPage{
 status:number;type:string;location?:string;title?:string[];description?:string[];canonical?:string[];robots?:string[];hreflang?:string[];
 schema?:string;headings?:string[];content?:string;textSample?:string;links?:string[];images?:string[];
}
export interface DynamicRedirect{status:number;targets:string[]}
export interface SeoSnapshot{version:1;domain:string;createdAt:string;pages:Record<string,SeoPage>;sitemaps:Record<string,{status:number;urls:string[]}>;robots:{status:number;text:string};resources:Record<string,number>;resourcePaths?:Record<string,string[]>;dynamicRedirects?:Record<string,DynamicRedirect>}
export interface SeoDifference{path:string;field:string;before:unknown;after:unknown}
export interface ProbeOptions{origin:string;domain:string;headers?:Record<string,string>;routes?:{prefix:string;origin:string}[];paths:string[];redirects?:string[];dynamicRedirects?:Record<string,DynamicRedirect>;maxUrls?:number;concurrency?:number;seed?:SeoSnapshot;signal?:AbortSignal}
function localPath(value:string,domain:string){try{const url=new URL(value,domain);if(url.origin!==new URL(domain).origin)return null;url.hash='';url.searchParams.sort();return url.pathname+url.search;}catch{return null;}}
function logicalUrl(value:string,domain:string){try{return new URL(value,domain).href.replace(/\/_site\/[\w-]+\//g,'/_site/{build}/');}catch{return value;}}
export function upgradeProbePath(stamp:string,target:string,build?:string){return '/__weava_upgrade_missing_'+digest([stamp,target,build??null]).slice(0,32);}
export function analyzePage(html:string,status:number,headers:Headers,domain:string,path:string):{page:SeoPage;discover:string[];resources:string[]}{
 const base=new URL(path,domain).href;
 const type=(headers.get('content-type')??'').split(';')[0].toLowerCase(),page:SeoPage={status,type};
 if(status>=300&&status<400){page.location=logicalUrl(headers.get('location')??'',domain);const target=localPath(page.location,domain);return{page,discover:target?[target]:[],resources:[]};}
 if(!type.includes('html')||status!==200)return{page,discover:[],resources:[]};
 const $=load(html),meta=(name:string)=>$(`meta[name="${name}"]`).map((_,e)=>clean($(e).attr('content')??'')).get();
 page.title=$('head title').map((_,e)=>clean($(e).text())).get();page.description=meta('description');
 page.canonical=$('link[rel~="canonical"]').map((_,e)=>logicalUrl($(e).attr('href')??'',domain)).get();
 page.robots=sorted([...meta('robots'),...meta('googlebot'),headers.get('x-robots-tag')??''].filter(Boolean).map(v=>v.toLowerCase().split(',').map(clean).sort().join(',')));
 page.hreflang=sorted($('link[hreflang]').map((_,e)=>($(e).attr('hreflang')??'')+':'+logicalUrl($(e).attr('href')??'',domain)).get());
 const schemas=$('script[type="application/ld+json"]').map((_,e)=>{const text=$(e).text();try{return JSON.stringify(stable(JSON.parse(text)));}catch{throw new Error('结构化数据不是有效 JSON：'+path);}}).get();page.schema=digest(sorted(schemas));
 // Live comments/counters are not authored article text. Keep all other visible
 // text; styling, script bundles and attribute order may change safely.
 $('script,style,noscript,template,#comments,[data-comment-list],[data-like-count],[data-comment-count],[data-weava-live],[hidden],[aria-hidden="true"]').remove();
 page.headings=$('h1').map((_,e)=>clean($(e).text())).get();
 const main=$('main').length?$('main').first():$('body'),copy=main.clone();copy.find('article,p,div,section,h1,h2,h3,h4,h5,h6,li,br').append(' ');const text=clean(copy.text());page.content=digest(text);page.textSample=text.slice(0,500);
 const links=sorted($('a[href]').map((_,e)=>localPath($(e).attr('href')??'',base)).get().filter((v):v is string=>!!v&&!reserved.test(v)&&!v.startsWith('/#')));
 page.links=links;
 const images=sorted($('img[src],video[poster],source[srcset],img[srcset]').map((_,e)=>[$(e).attr('src'),$(e).attr('poster'),...($(e).attr('srcset')??'').split(',').map(v=>v.trim().split(/\s+/)[0])].filter(Boolean).map(v=>new URL(v!,base).href)).get());
 page.images=sorted(images.map(value=>logicalUrl(value,domain)));
 const discover=links.filter(value=>!/[.](?:pdf|zip|png|jpg|jpeg|webp|avif|gif|svg|mp4|mp3|woff2?)(?:\?|$)/i.test(value));
 return {page,discover,resources:images.map(value=>localPath(value,domain)).filter((v):v is string=>!!v)};
}
async function readBounded(response:Response,max:number){
 const reader=response.body?.getReader();if(!reader)return '';let size=0;const parts:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('SEO 检查响应超过大小限制：'+response.url);parts.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(parts).toString('utf8');
}
export async function captureSeo(options:ProbeOptions):Promise<SeoSnapshot>{
 if(Object.keys(options.headers??{}).some(key=>['authorization','cookie'].includes(key.toLowerCase())))throw new Error('SEO 检查必须使用匿名访问，不能携带登录凭据。');
 const {domain}=options,max=options.maxUrls??50000,limit=options.concurrency??4;
 const snapshot:SeoSnapshot={version:1,domain,createdAt:new Date().toISOString(),pages:{},sitemaps:{},robots:{status:404,text:''},resources:{},resourcePaths:{},dynamicRedirects:options.dynamicRedirects??{}};
 const routes=[...(options.routes??[])].sort((a,b)=>b.prefix.length-a.prefix.length);
 const request=async(path:string,method='GET')=>{
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))throw new Error('SEO 检查路径无效。');
  const route=routes.find(route=>new URL(path,options.domain).pathname.startsWith(route.prefix));
  for(let attempt=0;;attempt++){
   const response=await fetch(new URL(path,route?.origin??options.origin),{method,redirect:'manual',headers:{Host:new URL(domain).host,'X-Forwarded-Proto':new URL(domain).protocol.slice(0,-1),'User-Agent':'WeavaUpgradeCheck',...(!route||route.origin===options.origin?options.headers:{})},signal:AbortSignal.any([AbortSignal.timeout(20000),...(options.signal?[options.signal]:[])])});
   // A resource may depend on an upstream redirect. Retry transient failures,
   // while still reporting a persistently unavailable resource as a regression.
   if(method!=='HEAD'||response.status<500||attempt>=2)return response;
   await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));
  }
 };
 const robots=await request('/robots.txt');snapshot.robots={status:robots.status,text:await readBounded(robots,1024*1024)};
 if(robots.status>=500)throw new Error('robots.txt 暂不可用，已取消升级检查。');
 const maps=['/sitemap.xml',...Object.keys(options.seed?.sitemaps??{})],initial=[...options.paths,...(options.redirects??[]),...Object.keys(options.dynamicRedirects??{}),...Object.keys(options.seed?.pages??{})];
 for(let i=0;i<maps.length;i++){
  const path=maps[i];if(snapshot.sitemaps[path])continue;if(Object.keys(snapshot.sitemaps).length>=1000)throw new Error('网站地图索引超过检查限制。');
  const response=await request(path),xml=await readBounded(response,52*1024*1024),$=load(xml,{xmlMode:true}),urls=sorted($('url > loc').map((_,e)=>$(e).text().trim()).get());
  snapshot.sitemaps[path]={status:response.status,urls};
  if(response.status>=500)throw new Error('网站地图暂不可用：'+path);
  if(response.ok){for(const loc of $('sitemap > loc').map((_,e)=>$(e).text().trim()).get()){const path=localPath(loc,domain);if(!path)throw new Error('网站地图索引指向站外地址，请检查：'+loc);maps.push(path);}
   for(const loc of urls){const path=localPath(loc,domain);if(!path)throw new Error('网站地图包含站外地址，请检查：'+loc);initial.push(path);}}
 }
 const queued=new Set<string>(),resources=new Set<string>();let frontier:string[]=[];
 const enqueue=(path:string)=>{const parsed=localPath(path,domain);if(!parsed||reserved.test(parsed)||queued.has(parsed))return;if(queued.size>=max)throw new Error('公开页面超过 SEO 检查上限，未使用抽样代替完整检查。');queued.add(parsed);frontier.push(parsed);};
 for(const path of initial)enqueue(path);enqueue('/');
 while(frontier.length){const batch=frontier.splice(0,limit);await Promise.all(batch.map(async path=>{
   const staticPath=routes.some(route=>new URL(path,options.domain).pathname.startsWith(route.prefix));
   let response=await request(path,staticPath?'HEAD':'GET');
   if(staticPath&&response.status===200&&response.headers.get('content-type')?.includes('html')){await response.body?.cancel();response=await request(path);}
   let text='';if(response.headers.get('content-type')?.includes('html'))text=await readBounded(response,4*1024*1024);else await response.body?.cancel();const result=analyzePage(text,response.status,response.headers,domain,path);
   const dynamic=options.dynamicRedirects?.[path];if(dynamic&&result.page.status===dynamic.status&&dynamic.targets.includes(result.page.location??''))result.page.location='dynamic:'+path;
   snapshot.pages[path]=result.page;result.discover.forEach(enqueue);result.resources.forEach(path=>resources.add(path));
  }));}
 const identity=(path:string)=>localPath(logicalUrl(path,domain),domain)!;
 const current=new Set([...resources].map(identity));
 for(const key of Object.keys(options.seed?.resources??{}))if(!current.has(key)){
  // Revisit an old resource only by its real URL. A comparison key is never a request URL.
  const paths=options.seed?.resourcePaths?.[key]??(!key.includes('%7Bbuild%7D')&&!key.includes('{build}')?[key]:[]);
  paths.forEach(path=>resources.add(path));
  if(!paths.length)snapshot.resources[key]=404;
 }
 const pending=[...resources];for(let i=0;i<pending.length;i+=limit)await Promise.all(pending.slice(i,i+limit).map(async path=>{
  const response=await request(path,'HEAD'),key=identity(path),old=snapshot.resources[key];
  snapshot.resources[key]=old===undefined?response.status:old>=400?old:response.status;
  (snapshot.resourcePaths![key]??=[]).push(path);await response.body?.cancel();
 }));
 return snapshot;
}
const robotsPolicy=(text:string)=>text.split(/\r?\n/).map(line=>line.split('#')[0].trim()).filter(Boolean).join('\n');
export function compareSeo(before:SeoSnapshot,after:SeoSnapshot){
 const differences:SeoDifference[]=[],add=(path:string,field:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))differences.push({path,field,before:a,after:b});};
 add('/','domain',before.domain,after.domain);add('/','dynamic-redirect-policy',before.dynamicRedirects??{},after.dynamicRedirects??{});add('/robots.txt','status',before.robots.status,after.robots.status);add('/robots.txt','policy',robotsPolicy(before.robots.text),robotsPolicy(after.robots.text));
 for(const path of sorted([...Object.keys(before.sitemaps),...Object.keys(after.sitemaps)])){add(path,'sitemap',before.sitemaps[path],after.sitemaps[path]);}
 for(const path of sorted([...Object.keys(before.pages),...Object.keys(after.pages)])){
  const a=before.pages[path],b=after.pages[path];if(!a||!b){add(path,'page',a??null,b??null);continue;}
  for(const key of ['status','type','location','title','description','canonical','robots','hreflang','schema','headings','content','links','images'] as const)add(path,key,a[key]??null,b[key]??null);
 }
 for(const path of Object.keys(before.resources))if(before.resources[path]>=200&&before.resources[path]<400&&(!after.resources[path]||after.resources[path]>=400))add(path,'resource-status',before.resources[path],after.resources[path]??null);
 return {passed:!differences.length,checkedPages:Object.keys(before.pages).length,checkedResources:Object.keys(before.resources).length,differences};
}
export function requireSeo(before:SeoSnapshot,after:SeoSnapshot){const report=compareSeo(before,after);if(!report.passed)throw Object.assign(new Error('SEO 对比未通过：'+report.differences.slice(0,5).map(item=>item.path+' ['+item.field+']').join('；')),{seoReport:report});return report;}
