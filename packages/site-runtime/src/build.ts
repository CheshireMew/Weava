import {build as astroBuild} from 'astro';
import react from '@astrojs/react';
import {build as esbuild} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join,resolve,relative} from 'node:path';
import {mkdirSync,existsSync,writeFileSync,readdirSync,lstatSync,readFileSync,symlinkSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [root,programRoot]=process.argv.slice(2);
const source=join(root,'custom'),id=randomUUID(),out=join(root,'site-builds',id);
if(!existsSync(join(source,'src/pages')))throw new Error('请在网站 custom/src/pages 中编写页面和接口。');
mkdirSync(out,{recursive:true});
writeFileSync(join(out,'build-state.json'),JSON.stringify({version:1,id,status:'building',dependencyReference:'node_modules'}));
const modules=join(out,'node_modules');symlinkSync(join(programRoot,'node_modules'),modules,'junction');
const requireFromProgram=createRequire(join(programRoot,'package.json'));
let routes:{route:string;type:string;prerender:boolean;pathname?:string;pattern:string}[]=[];
const integration={
 name:'weava-site',
 hooks:{
  'astro:routes:resolved':({routes:resolved}:any)=>{
    routes=resolved.filter((r:any)=>!r.origin||r.origin==='project').map((r:any)=>({route:r.route,type:r.type,prerender:r.prerender,pathname:r.pathname,pattern:r.pattern.source}));
    for(const r of routes)if(/^\/(?:admin|api\/admin|api\/v1|media|__preview|__health|_admin|_site)(?:\/|$)/.test(r.route))throw new Error('专用页面不能覆盖框架入口：'+r.route);
  },
  'astro:config:done':({setAdapter}:any)=>setAdapter({name:'weava-site',serverEntrypoint:pathToFileURL(join(programRoot,'runtime/site-entry.mjs')),entrypointResolution:'auto',supportedAstroFeatures:{serverOutput:'stable',staticOutput:'stable',hybridOutput:'stable',i18nDomains:'stable',sharpImageService:'stable'}}),
 }
};
try {
await astroBuild({root:source,configFile:false,output:'server',outDir:out,cacheDir:join(out,'cache'),adapter:integration,integrations:[react()],
 build:{assetsPrefix:'/_site/'+id,inlineStylesheets:'never'},
 vite:{plugins:[{name:'weava-shared-packages',enforce:'pre',async resolveId(this:any,id:string){if(id.startsWith('.')||id.startsWith('/')||id.includes(':')||id.startsWith('\0')||id==='@weava/site')return;return this.resolve(id,join(programRoot,'runtime/shared-resolver.mjs'),{skipSelf:true});}}],resolve:{alias:{'@weava/site':join(programRoot,'runtime/site-public.mjs')}},
  ssr:{external:['better-sqlite3','sharp'],noExternal:[]}},
});
let migrations:string|undefined;
let extensions:string|undefined;
if(existsSync(join(source,'extensions.ts'))){
 extensions='extensions';mkdirSync(join(out,extensions),{recursive:true});
 await esbuild({entryPoints:[join(source,'extensions.ts')],outfile:join(out,extensions,'index.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',alias:{'@weava/site':join(programRoot,'runtime/site-public.mjs')}});
}
if(existsSync(join(source,'migrations.ts'))){
 migrations='server/website-migrations.mjs';
 await esbuild({entryPoints:[join(source,'migrations.ts')],outfile:join(out,migrations),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
}
function walk(folder:string):string[]{return readdirSync(folder).flatMap(name=>{if(['node_modules','cache','build-state.json'].includes(name))return [];const p=join(folder,name),s=lstatSync(p);return s.isDirectory()?walk(p):[p];});}
const files=walk(out).map(path=>({path:relative(out,path).replaceAll('\\','/'),hash:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const entry=existsSync(join(out,'server/entry.mjs'))?'server/entry.mjs':files.find(f=>f.path.endsWith('/entry.mjs'))?.path;
if(!entry)throw new Error('网站构建缺少服务端入口。');
writeFileSync(join(out,'site-build.json'),JSON.stringify({version:1,id,sdkVersion:1,entry,migrations,extensions,routes,programId:JSON.parse(readFileSync(join(programRoot,'program.json'),'utf8')).id,dependencyReference:'node_modules',files},null,2));
console.log(JSON.stringify({id,root:out,files:files.length}));
writeFileSync(join(out,'build-state.json'),JSON.stringify({version:1,id,status:'complete',dependencyReference:'node_modules'}));
} catch(error) {
 writeFileSync(join(out,'build-state.json'),JSON.stringify({version:1,id,status:'failed',dependencyReference:'node_modules',error:String(error)}));
 throw error;
}

