import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { Site, writeProgramManifest, verifyProgram, checkProgramUpgrade, applyProgramUpgrade, recoverProgramUpgrade, selectedProgram } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base='D:/Tools/cache/weava/tests/programs-'+Date.now();let sequence=0;const sites:Site[]=[];
function fixture(check=''){
  const root=join(base,String(sequence++)),siteRoot=join(root,'site'),programRoot=join(root,'program'),backupRoot=join(root,'backups');mkdirSync(root,{recursive:true});
  const site=new Site(siteRoot);sites.push(site);site.saveEntry(entrySchema.parse({id:'page',kind:'page',title:'升级前内容',path:'/page/',status:'published'}),null);site.publish();
  for(const folder of ['runtime','admin','web/server'])mkdirSync(join(programRoot,folder),{recursive:true});
  for(const name of ['runtime/weava.mjs','runtime/worker.mjs','web/server/entry.mjs','admin/index.html'])writeFileSync(join(programRoot,name),'placeholder');
  writeFileSync(join(programRoot,'runtime/check.mjs'),`import Database from 'better-sqlite3';import {writeFileSync} from 'node:fs';const root=process.argv[2];const db=new Database(root+'/weava.sqlite');${check}console.log(JSON.stringify({ok:true}));db.close();`);
  symlinkSync(resolve('node_modules'),join(programRoot,'node_modules'),'junction');writeProgramManifest(programRoot,resolve('node_modules'));
  return {site,siteRoot,programRoot,backupRoot};
}
afterEach(()=>sites.splice(0).forEach((site)=>{try{site.close();}catch{}}));
describe('versioned program upgrade and recovery',()=>{
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
