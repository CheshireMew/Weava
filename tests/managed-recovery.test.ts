import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Site} from '../packages/core/src/site.ts';
import {atomic,hash,saveInstallation,loadInstallation} from '../packages/manager/src/state.ts';
import {recoverFiles,authoredFingerprint} from '../packages/manager/src/recovery.ts';
import {repairProgramLinks,repairSiteBuildLink} from '../packages/manager/src/relink.ts';
import {createBackup,verifyBackup} from '../packages/core/src/backup.ts';
const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/shared-runtime-20261105';
function fixture(){const root=join(base,'recovery-'+randomUUID());mkdirSync(root,{recursive:true});return root;}
describe('managed recovery and dependency references',()=>{
 it('keeps registrations made by independent concurrent commands',async()=>{
  const root=fixture();saveInstallation(root,{version:1,id:randomUUID(),node:process.execPath,sitesRoot:join(root,'sites'),backupRoot:join(root,'backups'),programs:{},sites:{}});
  const source=pathToFileURL(join(process.cwd(),'packages/manager/src/state.ts')).href;
  await Promise.all([0,1,2].map(index=>new Promise<void>((resolve,reject)=>{
   const code=`import {updateInstallation} from ${JSON.stringify(source)};updateInstallation(${JSON.stringify(root)},value=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);value.sites['site-${index}']={root:${JSON.stringify(join(root,'site-'+index))},autostart:false};});`;
   const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',bytes=>error+=bytes);child.once('error',reject);child.once('exit',code=>code?reject(new Error(error)):resolve());
  })));
  expect(Object.keys(loadInstallation(root).sites).sort()).toEqual(['site-0','site-1','site-2']);
 });
 it('restores recorded files and absent files without deleting failed evidence',()=>{
  const root=fixture(),point=join(root,'point'),site=join(root,'site');mkdirSync(point,{recursive:true});mkdirSync(site);
  writeFileSync(join(point,'site.json'),'before');writeFileSync(join(site,'site.json'),'after');writeFileSync(join(site,'business.sqlite'),'created');
  atomic(join(point,'recovery.json'),{version:1,kind:'migration-recovery',root:site,entries:[{path:'site.json',hash:hash('before')}],absent:['business.sqlite'],createdAt:new Date().toISOString()});
  const result=recoverFiles(point,site);
  expect(readFileSync(join(site,'site.json'),'utf8')).toBe('before');expect(existsSync(join(site,'business.sqlite'))).toBe(false);
  expect(readFileSync(join(result.retained!,'business.sqlite'),'utf8')).toBe('created');
  expect(recoverFiles(point,site)).toMatchObject({reused:true});
 });
 it('refuses damaged recovery members before moving live data',()=>{
  const root=fixture(),point=join(root,'point');mkdirSync(point);writeFileSync(join(root,'site.json'),'live');writeFileSync(join(point,'site.json'),'damaged');
  atomic(join(point,'recovery.json'),{version:1,kind:'migration-recovery',root,entries:[{path:'site.json',hash:hash('original')}],absent:[]});
  expect(()=>recoverFiles(point,root)).toThrow(/校验失败/);expect(readFileSync(join(root,'site.json'),'utf8')).toBe('live');
 });
 it('preserves existing account values while allowing a missing system secret to initialize',()=>{
  const root=fixture(),site=new Site(join(root,'site')),before=authoredFingerprint(site.root);
  site.store.raw.prepare("DELETE FROM state WHERE key='engagement-secret'").run();
  const legacy=authoredFingerprint(site.root);
  site.store.raw.prepare("INSERT INTO state(key,value) VALUES('engagement-secret','new-system-secret')").run();
  expect(authoredFingerprint(site.root,Object.keys(legacy.account))).toEqual(legacy);
  expect(authoredFingerprint(site.root).account).not.toEqual(before.account);
  site.close();
 });
 it('rebinds only owned junctions and leaves old dependency contents intact',()=>{
  const root=fixture(),program=join(root,'program'),target=join(program,'node_modules/.store/one/node_modules/foo'),old=join(root,'old');
  mkdirSync(target,{recursive:true});mkdirSync(old);writeFileSync(join(old,'owner.txt'),'user file');
  symlinkSync(old,join(program,'node_modules/foo'),'junction');
  atomic(join(program,'program.json'),{dependencyLinks:[{path:'node_modules/foo',target:'node_modules/.store/one/node_modules/foo'}]});
  expect(repairProgramLinks(program,join(root,'evidence')).rebuilt).toBe(1);
  expect(realpathSync.native(join(program,'node_modules/foo')).toLowerCase()).toBe(realpathSync.native(target).toLowerCase());
  expect(readFileSync(join(old,'owner.txt'),'utf8')).toBe('user file');
 });
 it('repairs a dangling website build reference after its program has moved',()=>{
  const root=fixture(),site=join(root,'site'),build=join(site,'site-builds','one'),program=join(root,'program');mkdirSync(build,{recursive:true});mkdirSync(join(program,'node_modules'),{recursive:true});
  atomic(join(build,'site-build.json'),{dependencyReference:'node_modules'});symlinkSync(join(root,'previous-program','node_modules'),join(build,'node_modules'),'junction');
  repairSiteBuildLink(site,'one',program);expect(realpathSync.native(join(build,'node_modules')).toLowerCase()).toBe(realpathSync.native(join(program,'node_modules')).toLowerCase());
 });
 it('includes website source, build and business data in backups without copying shared packages',async()=>{
  const root=fixture(),site=new Site(join(root,'site')),build=join(site.root,'site-builds/one'),shared=join(root,'shared');
  mkdirSync(build,{recursive:true});mkdirSync(shared);writeFileSync(join(shared,'large.txt'),'shared framework');
  atomic(join(build,'site-build.json'),{id:'one',dependencyReference:'node_modules'});writeFileSync(join(build,'entry.mjs'),'export{};');symlinkSync(shared,join(build,'node_modules'),'junction');
  mkdirSync(join(site.root,'custom'),{recursive:true});writeFileSync(join(site.root,'custom/source.ts'),'site code');
  const backup=await createBackup(site,join(root,'backups'));
  const manifest=verifyBackup(backup.path);
  expect(manifest.files.some((f:any)=>f.path==='custom/source.ts')).toBe(true);
  expect(manifest.files.some((f:any)=>f.path==='site-builds/one/entry.mjs')).toBe(true);
  expect(manifest.files.some((f:any)=>f.path.includes('node_modules'))).toBe(false);site.close();
 });
});

