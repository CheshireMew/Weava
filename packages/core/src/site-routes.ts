import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export interface SiteRoute {route:string;type:string;prerender?:boolean;pathname?:string;pattern?:string}
/** Deployment routing metadata is shared by HTTP dispatch, publication and inventory. */
export function siteBuild(root:string){
  const file=join(root,'program.json');if(!existsSync(file))return null;
  const selection=JSON.parse(readFileSync(file,'utf8'));if(!selection.siteBuildId)return null;
  if(!/^[\w-]+$/.test(selection.siteBuildId))throw new Error('网站构建编号无效。');
  const folder=join(process.env.WEAVA_SITE_BUILDS_ROOT??join(root,'site-builds'),selection.siteBuildId);
  const bytes=readFileSync(join(folder,'site-build.json')),manifest=JSON.parse(bytes.toString('utf8'));
  if(selection.siteBuildHash&&createHash('sha256').update(bytes).digest('hex')!==selection.siteBuildHash)throw new Error('网站构建清单发生变化。');
  if(manifest.programId!==selection.programId||manifest.id!==selection.siteBuildId||manifest.sdkVersion!==1)throw new Error('网站构建与当前程序或 SDK 不匹配。');
  return {folder,manifest,selection};
}
function legacyPattern(route:string){
  const escaped=route.replace(/\[\.\.\.([^\]]+)\]/g,'__WEAVA_REST__').replace(/\[([^\]]+)\]/g,'__WEAVA_PARAM__').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('^'+escaped.replace(/\/__WEAVA_REST__/g,'(?:/.*)?').replaceAll('__WEAVA_PARAM__','[^/]+').replace(/\/$/,'')+'/?$');
}
export function siteRoutes(root:string){
  const build=siteBuild(root),routes:SiteRoute[]=build?.manifest.routes??[];
  const patterns=routes.map(route=>route.pattern?new RegExp(route.pattern):legacyPattern(route.route));
  return {
    build,
    paths:routes.filter(route=>route.type==='page'&&!route.route.includes('[')).map(route=>route.pathname??route.route),
    matches(path:string){
      let decoded:string;try{decoded=decodeURI(path.split('?')[0]);}catch{return false;}
      if(patterns.some(pattern=>pattern.test(decoded)))return true;
      if(!build)return false;
      const prefix='/_site/'+build.manifest.id+'/';
      const asset=decoded.startsWith(prefix)?decoded.slice(prefix.length):decoded.slice(1);
      return build.manifest.files.some((file:{path:string})=>file.path==='client/'+asset);
    },
  };
}
