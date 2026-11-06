import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { Site, writeProgramManifest, verifyProgram, checkProgramUpgrade, applyProgramUpgrade, recoverProgramUpgrade, selectedProgram, selectDefaultProgram, defaultProgram, programStatus } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { freezeProgramDependencies, verifyProgramDependencies } from '../packages/core/src/program-dependencies.ts';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { selected as selectedManaged } from '../packages/manager/src/state.ts';
import { saveInstallation } from '../packages/manager/src/state.ts';
import { onlineWorkspace } from '../packages/manager/src/operations.ts';
const base='D:/Tools/cache/weava/tests/programs-'+Date.now();let sequence=0;const sites:Site[]=[];
function fixture(check=''){
  const root=join(base,String(sequence++)),siteRoot=join(root,'site'),programRoot=join(root,'program'),backupRoot=join(root,'backups');mkdirSync(root,{recursive:true});
  const site=new Site(siteRoot);sites.push(site);site.saveEntry(entrySchema.parse({id:'page',kind:'page',title:'升级前内容',path:'/page/',status:'published'}),null);site.publish();
  for(const folder of ['runtime','admin','web/server'])mkdirSync(join(programRoot,folder),{recursive:true});
  for(const name of ['runtime/weava.mjs','runtime/worker.mjs','web/server/entry.mjs','admin/index.html'])writeFileSync(join(programRoot,name),'placeholder');
  writeFileSync(join(programRoot,'runtime/check.mjs'),`import Database from 'better-sqlite3';import {writeFileSync} from 'node:fs';const root=process.argv[2];const db=new Database(root+'/weava.sqlite');${check}console.log(JSON.stringify({ok:true}));db.close();`);
  const dependencyRoot=join(root,'dependency-source');mkdirSync(join(dependencyRoot,'node_modules'),{recursive:true});
  writeFileSync(join(dependencyRoot,'package.json'),JSON.stringify({dependencies:{'better-sqlite3':'13.0.3'}}));
  symlinkSync(resolve('node_modules/better-sqlite3'),join(dependencyRoot,'node_modules/better-sqlite3'),'junction');
  writeProgramManifest(programRoot,join(dependencyRoot,'node_modules'));
  return {site,siteRoot,programRoot,backupRoot};
}
afterEach(()=>sites.splice(0).forEach((site)=>{try{site.close();}catch{}}));
describe('versioned program upgrade and recovery',()=>{
  it('stages binary theme assets for offline checks while leaving user media and raw imports in place',async()=>{
    const root=join(base,'theme-preflight'),home=join(root,'installation'),site=new Site(join(root,'site'));sites.push(site);
    saveInstallation(home,{version:1,id:'test',node:process.execPath,sitesRoot:root,backupRoot:join(root,'checks'),programs:{},sites:{}});
    writeFileSync(join(site.root,'site.json'),JSON.stringify({version:2,id:'theme-check',port:4508,features:['content'],template:'blank'}));
    mkdirSync(join(site.root,'themes/theme'),{recursive:true});mkdirSync(join(site.root,'imports'),{recursive:true});
    const logo=Buffer.from([137,80,78,71,13,10,26,10]);writeFileSync(join(site.root,'themes/theme/logo.png'),logo);
    writeFileSync(join(site.root,'media/user.png'),logo);writeFileSync(join(site.root,'imports/source.csv'),'user media list');writeFileSync(join(site.root,'imports/config.json'),'{}');
    const result=await onlineWorkspace(home,site.root,{root:join(root,'program'),manifest:{id:'test'},manifestHash:'a'.repeat(64)});
    expect(readFileSync(join(result.root,'themes/theme/logo.png'))).toEqual(logo);
    expect(existsSync(join(result.root,'imports/config.json'))).toBe(true);
    expect(existsSync(join(result.root,'imports/source.csv'))).toBe(false);
    expect(existsSync(join(result.root,'media/user.png'))).toBe(false);
  });
  it('reads manager status metadata without scanning files while keeping execution verification mandatory',()=>{
    const root=join(base,'manager-status'),program=join(root,'program'),site=join(root,'site');
    mkdirSync(program,{recursive:true});mkdirSync(site,{recursive:true});
    const id='11111111-1111-4111-8111-111111111111';
    const source=JSON.stringify({version:1,id,framework:'0.2.0',apiVersion:1,schemaVersion:12,nodeMajor:Number(process.versions.node.split('.')[0]),files:['runtime/weava.mjs','runtime/check.mjs','runtime/worker.mjs','runtime/manager.mjs','web/server/entry.mjs','admin/index.html'].map(path=>({path,hash:'absent'}))});
    const manifestHash=createHash('sha256').update(source).digest('hex');writeFileSync(join(program,'program.json'),source);
    writeFileSync(join(site,'program.json'),JSON.stringify({version:2,programId:id,manifestHash,installationRoot:root,selectedAt:new Date().toISOString()}));
    const installation={defaultProgramId:id,programs:{[id]:{root:program,manifestHash}}} as any;
    expect(selectedManaged(installation,site,false).manifest.id).toBe(id);
    expect(()=>selectedManaged(installation,site)).toThrow(/程序文件校验失败/);
    writeFileSync(join(program,'program.json'),'{}');expect(()=>selectedManaged(installation,site,false)).toThrow(/发生变化/);
  });
  it('reads managed status without scanning program files and reflects a changed selection immediately',()=>{
    const root=join(base,'managed-status'),installation=join(root,'installation'),site=join(root,'site');
    mkdirSync(installation,{recursive:true});mkdirSync(site,{recursive:true});
    const programs:Record<string,{root:string;manifestHash:string}>={};
    for(const id of ['first','second']){
      const folder=join(installation,id);mkdirSync(folder,{recursive:true});
      // Deliberately absent files: display metadata must not read program bodies
      // or dependencies. Startup verification must still reject this program.
      const source=JSON.stringify({version:1,id,framework:'0.2.0',files:[{path:'runtime/absent.mjs',hash:'missing'}]});
      writeFileSync(join(folder,'program.json'),source);
      programs[id]={root:folder,manifestHash:createHash('sha256').update(source).digest('hex')};
    }
    writeFileSync(join(installation,'installation.json'),JSON.stringify({programs}));
    const select=(id:string)=>writeFileSync(join(site,'program.json'),JSON.stringify({version:2,programId:id,installationRoot:installation,manifestHash:programs[id].manifestHash,siteBuildId:'custom'}));
    select('first');expect(programStatus(site)).toMatchObject({selected:true,id:'first',framework:'0.2.0',root:resolve(programs.first.root),siteBuildId:'custom'});
    expect(()=>selectedProgram(site)).toThrow();
    select('second');expect(programStatus(site).id).toBe('second');
    writeFileSync(join(programs.second.root,'program.json'),'{}');expect(()=>programStatus(site)).toThrow(/清单发生变化/);
    writeFileSync(join(installation,'installation.json'),JSON.stringify({programs:{}}));expect(()=>programStatus(site)).toThrow(/尚未在本机登记/);
  });
  it('preserves unselected and legacy program status',()=>{
    const root=join(base,'legacy-status');mkdirSync(root,{recursive:true});
    expect(programStatus(root)).toMatchObject({selected:false});
    const pointer={version:1,id:'legacy',framework:'0.1.0',root:'legacy-program',upgradePlanId:'reviewed'};
    writeFileSync(join(root,'program.json'),JSON.stringify(pointer));
    expect(programStatus(root)).toEqual({selected:true,id:pointer.id,framework:pointer.framework,root:pointer.root,siteBuildId:undefined,upgradePlanId:'reviewed'});
  });
  it('ARC-15 keeps the selected build unchanged when a new candidate fails verification',()=>{
    const {programRoot}=fixture(),framework=join(base,'default-framework');selectDefaultProgram(framework,programRoot);
    const pointer=readFileSync(join(framework,'dist/current.json'),'utf8');expect(defaultProgram(framework)!.root).toBe(resolve(programRoot));
    const bad=join(base,'bad-program');mkdirSync(bad,{recursive:true});writeFileSync(join(bad,'program.json'),'{}');
    expect(()=>selectDefaultProgram(framework,bad)).toThrow();expect(readFileSync(join(framework,'dist/current.json'),'utf8')).toBe(pointer);
  });
  it('ARC-16 fixes transitive dependency bytes and detects subsequent frozen-file changes',()=>{
    const root=join(base,'dependency-integrity'),source=join(root,'source'),program=join(root,'program');
    for(const path of ['source/node_modules/foo','source/node_modules/bar','program/admin','program/web/server','program/runtime'])mkdirSync(join(root,path),{recursive:true});
    writeFileSync(join(source,'package.json'),JSON.stringify({dependencies:{foo:'1.0.0'}}));
    writeFileSync(join(source,'node_modules/foo/package.json'),JSON.stringify({name:'foo',version:'1.0.0',dependencies:{bar:'1.0.0'}}));
    writeFileSync(join(source,'node_modules/foo/index.js'),'module.exports=require("bar")');
    writeFileSync(join(source,'node_modules/bar/package.json'),JSON.stringify({name:'bar',version:'1.0.0'}));writeFileSync(join(source,'node_modules/bar/index.js'),'module.exports=1');
    const snapshot=freezeProgramDependencies(program,join(source,'node_modules'));
    writeFileSync(join(source,'node_modules/bar/index.js'),'module.exports=2');expect(()=>verifyProgramDependencies(program,snapshot)).not.toThrow();
    const bar=snapshot.files.find(file=>file.path.endsWith('/index.js')&&readFileSync(join(program,file.path),'utf8')==='module.exports=1')!;
    writeFileSync(join(program,bar.path),'module.exports=3');expect(()=>verifyProgramDependencies(program,snapshot)).toThrow(/校验失败/);
  });
  it('preserves sibling package paths used by native runtime libraries',()=>{
    const root=join(base,'native-siblings'),source=join(root,'source'),program=join(root,'program');
    const native=join(source,'node_modules/@fixture/native'),shared=join(source,'node_modules/@fixture/shared');
    mkdirSync(join(native,'lib'),{recursive:true});mkdirSync(join(shared,'lib'),{recursive:true});
    writeFileSync(join(source,'package.json'),JSON.stringify({dependencies:{'@fixture/native':'1.0.0'}}));
    writeFileSync(join(native,'package.json'),JSON.stringify({name:'@fixture/native',version:'1.0.0',main:'lib/index.cjs',optionalDependencies:{'@fixture/shared':'1.0.0'}}));
    writeFileSync(join(shared,'package.json'),JSON.stringify({name:'@fixture/shared',version:'1.0.0'}));
    writeFileSync(join(shared,'lib/value.txt'),'original runtime library');
    writeFileSync(join(native,'lib/index.cjs'),'module.exports=require("node:fs").readFileSync(require("node:path").join(__dirname,"../../shared/lib/value.txt"),"utf8")');
    const snapshot=freezeProgramDependencies(program,join(source,'node_modules'));
    writeFileSync(join(shared,'lib/value.txt'),'changed source library');
    expect(createRequire(join(program,'probe.cjs'))('@fixture/native')).toBe('original runtime library');
    expect(()=>verifyProgramDependencies(program,snapshot)).not.toThrow();
  });
  it('verifies program hashes, checks an isolated site copy, selects a version and restores the pre-upgrade instance',async()=>{
    const {site,siteRoot,programRoot,backupRoot}=fixture(`db.prepare("INSERT OR REPLACE INTO state VALUES('candidate','ready')").run();`);site.close();
    const plan=await checkProgramUpgrade(siteRoot,programRoot,backupRoot);expect(plan.probe.ok).toBe(true);expect(existsSync(plan.path)).toBe(true);
    const before=new Site(siteRoot);expect(before.store.state('candidate')).toBeUndefined();before.close();
    // A read-only inspection must not require the user to re-authorize a reviewed version.
    const result=await applyProgramUpgrade(plan);expect(result.applied).toBe(true);expect(selectedProgram(siteRoot)!.root).toBe(resolve(programRoot));
    const upgraded=new Site(siteRoot);expect(upgraded.store.state('candidate')).toBe('ready');upgraded.close();
    expect(recoverProgramUpgrade(siteRoot)).toMatchObject({recovered:false,status:'complete'});
    const restored=recoverProgramUpgrade(siteRoot,true);expect(restored.recovered).toBe(true);expect(existsSync(restored.retained!)).toBe(true);expect(selectedProgram(siteRoot)).toBeNull();
    const after=new Site(siteRoot);expect(after.store.state('candidate')).toBeUndefined();expect(after.release()!.entries[0].title).toBe('升级前内容');after.close();
  });
  it('rejects changed program files and changed instance data before changing the version selection',async()=>{
    const {site,siteRoot,programRoot,backupRoot}=fixture();site.close();const plan=await checkProgramUpgrade(siteRoot,programRoot,backupRoot);
    writeFileSync(join(programRoot,'admin/index.html'),'changed');expect(()=>verifyProgram(programRoot)).toThrow(/校验失败/);await expect(applyProgramUpgrade(plan)).rejects.toThrow(/校验失败/);expect(existsSync(join(siteRoot,'program.json'))).toBe(false);
    writeFileSync(join(programRoot,'admin/index.html'),'placeholder');writeFileSync(join(siteRoot,'new-config.json'),'{}');await expect(applyProgramUpgrade(plan)).rejects.toThrow(/资料已变化/);
  });
  it('restores a failed live migration from the verified preflight copy while retaining the failed directory',async()=>{
    const {site,siteRoot,programRoot,backupRoot}=fixture(`db.prepare("INSERT OR REPLACE INTO state VALUES('partial','migration')").run();if(!root.includes('upgrade-check-')){db.close();console.log(JSON.stringify({ok:false,error:'failed live migration'}));process.exit(1);}`);site.close();
    const plan=await checkProgramUpgrade(siteRoot,programRoot,backupRoot);await expect(applyProgramUpgrade(plan)).rejects.toThrow(/failed live migration/);
    const after=new Site(siteRoot);expect(after.store.state('partial')).toBeUndefined();expect(selectedProgram(siteRoot)).toBeNull();after.close();
    const journal=JSON.parse(readFileSync(siteRoot+'.upgrade.json','utf8'));expect(journal.status).toBe('rolled-back');expect(existsSync(journal.retained)).toBe(true);
  });
  it('recovers an interrupted validating stage without publishing or deleting the prior source instance',async()=>{
    const {site,siteRoot,programRoot,backupRoot}=fixture();site.close();const plan=await checkProgramUpgrade(siteRoot,programRoot,backupRoot);
    writeFileSync(siteRoot+'.upgrade.json',JSON.stringify({version:1,target:resolve(siteRoot),plan,status:'validating'}));
    const partial=new Site(siteRoot);partial.store.setState('partial','interrupted');partial.close();
    expect(recoverProgramUpgrade(siteRoot).recovered).toBe(true);const restored=new Site(siteRoot);expect(restored.store.state('partial')).toBeUndefined();restored.close();
  });
});
