import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SCHEMA_VERSION} from '../../packages/core/src/storage.ts';
import {hash,atomic,saveInstallation,type Program} from '../../packages/manager/src/state.ts';
import {VERSION,API_VERSION} from '../../packages/contracts/src/index.ts';

/** A few KB of owned fixture code, without copying a framework or dependencies. */
export function fixtureProgram(home:string,entry='export {};'):Program{
  const root=join(home,'program'),source=resolve('packages/core/src/site-maintenance.ts');
  const maintenance=`import{createRequire}from'node:module';import{pathToFileURL}from'node:url';const require=createRequire(${JSON.stringify(resolve('package.json'))});const{tsImport}=await import(pathToFileURL(require.resolve('tsx/esm/api')).href);await tsImport(${JSON.stringify(pathToFileURL(source).href)},import.meta.url);`;
  const content:Record<string,string>={
    'runtime/weava.mjs':'export {};','runtime/worker.mjs':'export {};','runtime/check.mjs':'export {};','runtime/manager.mjs':'export {};','runtime/site-maintenance.mjs':maintenance,'web/server/entry.mjs':entry,'admin/index.html':'<html>Fixture</html>',
    'node_modules/better-sqlite3/package.json':'{"name":"better-sqlite3","version":"0.0.0"}',
    'node_modules/fixture-value/package.json':'{"name":"fixture-value","version":"1.0.0","type":"module","exports":"./index.mjs"}',
    'node_modules/fixture-value/index.mjs':'export default "Shared dependency";',
  };
  for(const [name,value]of Object.entries(content)){const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);}
  const manifest={version:1,id:randomUUID(),framework:VERSION,apiVersion:API_VERSION,schemaVersion:SCHEMA_VERSION,nodeMajor:Number(process.versions.node.split('.')[0]),platform:process.platform,files:Object.entries(content).filter(([path])=>!path.startsWith('node_modules/')).map(([path,value])=>({path,hash:hash(value)})),dependencyFiles:Object.entries(content).filter(([path])=>path.startsWith('node_modules/')).map(([path,value])=>({path,hash:hash(value)})),dependencyLinks:[]};
  atomic(join(root,'program.json'),manifest);const manifestHash=hash(Buffer.from(JSON.stringify(manifest,null,2)));
  saveInstallation(home,{version:1,id:randomUUID(),node:process.execPath,sitesRoot:join(home,'sites'),backupRoot:join(home,'backups'),defaultProgramId:manifest.id,programs:{[manifest.id]:{root,manifestHash}},sites:{}});
  return {root,manifest,manifestHash};
}
export function fixtureBuild(siteRoot:string,home:string,program:Program){
  const root=join(siteRoot,'site-builds','one');mkdirSync(join(root,'server'),{recursive:true});mkdirSync(join(root,'client'),{recursive:true});
  const code='import value from "fixture-value";export function render(request,{weava}){return new Response("<html><body>"+value+" "+weava.settings.name+"</body></html>",{headers:{"Content-Type":"text/html"}});}';
  writeFileSync(join(root,'server/entry.mjs'),code);writeFileSync(join(root,'client/logo.svg'),'<svg/>');
  const manifest={version:1,id:'one',sdkVersion:1,programId:program.manifest.id,entry:'server/entry.mjs',dependencyReference:'node_modules',routes:[{route:'/tools/',pathname:'/tools/',type:'page',pattern:'^/tools/?$'},{route:'/products/[id]',type:'page',pattern:'^/products/([^/]+?)/?$'}],files:[{path:'server/entry.mjs',hash:hash(code)},{path:'client/logo.svg',hash:hash('<svg/>')}]};
  atomic(join(root,'site-build.json'),manifest);
  atomic(join(siteRoot,'program.json'),{version:2,programId:program.manifest.id,manifestHash:program.manifestHash,siteBuildId:'one',siteBuildHash:hash(Buffer.from(JSON.stringify(manifest,null,2))),installationRoot:home,selectedAt:new Date().toISOString()});
}
