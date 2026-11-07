import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {join,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {inside} from '../../runtime-common/src/paths.ts';
import {withWebsite,type WebsiteContext} from './site-sdk.ts';
import {assetResponse} from './asset-response.ts';
import {siteFeatures} from './site-features.ts';
import {siteRoutes} from './site-routes.ts';
export interface SiteRenderer{render(request:Request,context:WebsiteContext):Promise<Response|null>;publicPaths():string[]}
export async function loadSiteRenderer(root:string):Promise<SiteRenderer|null>{
 const routes=siteRoutes(root);if(!routes.build)return null;
 const {folder,manifest}=routes.build;
 for(const file of manifest.files){const path=inside(folder,file.path);if(lstatSync(path).isSymbolicLink()||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.hash)throw new Error('网站构建文件校验失败：'+file.path);}
 const server=await import(/* @vite-ignore */ pathToFileURL(inside(folder,manifest.entry)).href);
 const paths=new Set<string>();
 return {publicPaths:()=>[...paths],async render(request,context){
  const url=new URL(request.url),prefix='/_site/'+manifest.id+'/';
  const assetPath=url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):url.pathname.slice(1);
  const candidate=inside(join(folder,'client'),decodeURIComponent(assetPath));
  if(url.pathname.startsWith(prefix)||manifest.files.some((f:any)=>f.path==='client/'+assetPath)&&existsSync(candidate)&&lstatSync(candidate).isFile()){
   const file=candidate;
   if(!existsSync(file)||!lstatSync(file).isFile())return new Response('Not found',{status:404});
   const type:Record<string,string>={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
   return assetResponse(file,request,type[extname(file)]??'application/octet-stream',url.pathname.startsWith(prefix));
  }
  if(manifest.routes&&!routes.matches(url.pathname))return null;
  const response=await withWebsite(context,()=>server.render(request,{weava:context}));
  // Each Astro application owns its cookie class. Carry HTTP headers/body across,
  // not the private response symbols of the separately compiled application.
  if(response===null)return null;
  const headers=new Headers(response.headers);
  if(!context.preview&&siteFeatures(root).includes('analytics')&&response.status===200&&headers.get('content-type')?.includes('text/html')){
    if(!context.request.owner){if(paths.size>=2000)paths.delete(paths.values().next().value!);paths.add(url.pathname);}
    const html=await response.text(),script='<script src="/weava-analytics.js" defer></script>';
    headers.delete('content-length');
    return new Response(html.includes('/weava-analytics.js')?html:html.replace('</body>',script+'</body>'),{status:response.status,headers});
  }
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }};
}

