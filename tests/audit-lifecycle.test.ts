import { entrySchema } from '@weava/contracts';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { Site, Analytics, SCHEMA_VERSION, assertOffline, assertServiceStopped, createBackup, restoreBackup, withInstanceMaintenance, maintenanceEnvironment } from '@weava/core';

const base = 'D:/Tools/cache/weava/tests/audit-lifecycle-' + Date.now();
async function holdWriter(root: string) {
  const source = `import { Site } from './packages/core/src/site.ts';
    const site = new Site(process.argv[1]); console.log('ready');
    process.stdin.once('data',()=>{site.close();process.exit(0)}); process.stdin.resume();`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, root], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, TSX_DISABLE_CACHE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let text = '', error = '';
  child.stderr.on('data', (bytes) => { error += bytes; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('writer start timeout: ' + error)); }, 10000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('writer exited ' + code + ': ' + error)); });
    child.stdout.on('data', (bytes) => { text += bytes; if (text.includes('ready')) { clearTimeout(timer); resolve(); } });
  });
  return async () => {
    const closed = once(child, 'close'); child.stdin.end('stop');
    const timer = setTimeout(() => child.kill(), 5000);
    try { expect((await closed)[0]).toBe(0); } finally { clearTimeout(timer); }
  };
}

describe('audit maintenance boundaries', () => {
  it('WVA-02 blocks restore while another process still owns a writer after the web service stops', async () => {
    const root = join(base, 'worker'), site = new Site(root);
    const backup = await createBackup(site, join(base, 'backups')); site.close();
    writeFileSync(join(root, 'runtime.json'), JSON.stringify({ status: 'stopped', pid: process.pid }));
    const stop = await holdWriter(root);
    try {
      expect(() => assertOffline(root)).toThrow(/写入|任务|占用/);
      await expect(restoreBackup(backup.path, root, join(base, 'before'))).rejects.toThrow(/写入|任务|占用/);
    } finally { await stop(); }
    expect(() => assertOffline(root)).not.toThrow();
    await restoreBackup(backup.path, root, join(base, 'before'));
    const restored = new Site(root); restored.close();
  });
});

async function openInChild(root: string, delegated: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import {Site} from './packages/core/src/site.ts';try{const s=new Site(process.argv[1]);s.close();console.log('opened')}catch(e){console.error(e.message);process.exitCode=2}", root],
    { cwd: process.cwd(), windowsHide: true, env: { ...process.env, TSX_DISABLE_CACHE: '1', ...delegated }, stdio: ['ignore','pipe','pipe'] });
  let output = ''; child.stdout.on('data', (bytes) => output += bytes); child.stderr.on('data', (bytes) => output += bytes);
  const timer = setTimeout(() => child.kill(), 8000);
  try { const [code] = await once(child, 'close'); return { code, output }; } finally { clearTimeout(timer); }
}

it('WVA-02 excludes new processes throughout async maintenance, permits only its explicit probe, and releases after failure', async () => {
  const root = join(base, 'exclusive'); const initial = new Site(root); initial.close();
  await withInstanceMaintenance(root, async () => {
    const refused = await openInChild(root); expect(refused.code).toBe(2); expect(refused.output).toContain('离线维护');
    expect((await openInChild(root, maintenanceEnvironment(root))).code).toBe(0);
    const wrong = await openInChild(root, { ...maintenanceEnvironment(root), WEAVA_MAINTENANCE_TOKEN: 'wrong' }); expect(wrong.code).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await openInChild(root)).code).toBe(2);
  });
  await expect(withInstanceMaintenance(root, async () => { throw new Error('fixture preparation failed'); })).rejects.toThrow('fixture preparation failed');
  expect((await openInChild(root)).code).toBe(0);
  const analytics = new Analytics(root);
  try { expect(() => withInstanceMaintenance(root, () => undefined)).toThrow(/占用/); } finally { analytics.close(); }
  const first = new Site(root), second = new Site(root);
  try { expect(() => first.store.maintain(() => undefined)).toThrow(/占用/); } finally { second.close(); }
  expect(() => first.store.maintain(() => undefined)).not.toThrow(); first.close();
}, 30000);

it('WVA-02 lets the explicitly delegated upgrade probe migrate while the parent retains exclusive maintenance', async () => {
  const root=join(base,'delegated-schema-upgrade'),initial=new Site(root);
  initial.store.setState('preserved','original');
  initial.store.raw.prepare('DELETE FROM schema_migrations WHERE version=?').run(SCHEMA_VERSION);initial.close();
  await withInstanceMaintenance(root,async()=>{
    expect((await openInChild(root)).code).toBe(2);
    const result=await openInChild(root,{...maintenanceEnvironment(root),WEAVA_DATABASE_MODE:'migrate'});expect(result.code,result.output).toBe(0);
    // The child must not release its parent's maintenance lease on completion.
    expect((await openInChild(root)).code).toBe(2);
  });
  const upgraded=new Site(root);
  try{
    expect(upgraded.store.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({v:SCHEMA_VERSION});
    expect(upgraded.store.state('preserved')).toBe('original');
  }finally{upgraded.close();}
},20000);

it('WVA-02 keeps a real worker alive across web connection restart, refuses restore, and admits maintenance after completion', async () => {
  const root = join(base, 'real-worker'), site = new Site(root);
  site.saveEntry(entrySchema.parse({ id:'held',kind:'page',title:'Held',path:'/held/',status:'published',visibility:'public',fields:{},blocks:[],categories:[],tags:[] }),null);
  writeFileSync(join(root,'extensions','index.mjs'), `import {existsSync,writeFileSync} from 'node:fs'; export default({site})=>({id:'held',apiVersion:1,render:async(entry)=>{if(entry.id==='held'){writeFileSync(site.root+'/worker-ready','ready');while(!existsSync(site.root+'/worker-continue'))await new Promise(r=>setTimeout(r,25));}return null;}});`);
  const backup = await createBackup(site,join(base,'real-backups'));
  const job=site.createJob('publish',{}); site.close();
  writeFileSync(join(root,'runtime.json'),JSON.stringify({status:'stopped',pid:process.pid}));
  const child=spawn(process.execPath,['--import','tsx','packages/core/src/worker.ts',root,job.id],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TSX_DISABLE_CACHE:'1'}});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const exited=once(child,'close'); const timer=setTimeout(()=>child.kill(),12000);
  try {
    for(let i=0;i<100&&!existsSync(join(root,'worker-ready'))&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,50));
    expect(existsSync(join(root,'worker-ready')),output).toBe(true);
    expect(()=>assertServiceStopped(root)).not.toThrow();
    const restarted=new Site(root); restarted.recoverJobs();
    try { expect(restarted.job(job.id).status).toBe('running'); expect(()=>assertOffline(root)).toThrow(/任务|占用/); }
    finally { restarted.close(); }
    await expect(restoreBackup(backup.path,root,join(base,'real-before'))).rejects.toThrow(/任务|占用/);
    writeFileSync(join(root,'worker-continue'),'continue');
    expect((await exited)[0],output).toBe(0);
    expect(()=>assertOffline(root)).not.toThrow();
    const completed=new Site(root);try{expect(completed.job(job.id).status).toBe('complete');expect(completed.release()?.entries.some(e=>e.id==='held')).toBe(true);}finally{completed.close();}
    await restoreBackup(backup.path,root,join(base,'real-before'));
  } finally { clearTimeout(timer); if(child.exitCode===null){writeFileSync(join(root,'worker-continue'),'continue');child.kill();await exited;} }
},20000);

it('WVA-02 schema upgrade excludes another open writer and releases a failed constructor before retry', () => {
  const root=join(base,'schema-upgrade'), writer=new Site(root);
  writer.store.raw.exec('DELETE FROM schema_migrations WHERE version>=4');
  try { expect(()=>new Site(root,{mode:'migrate'})).toThrow(/占用/); } finally { writer.close(); }
  const upgraded=new Site(root,{mode:'migrate'});
  try { expect(upgraded.store.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({v:SCHEMA_VERSION}); }
  finally { upgraded.close(); }
  expect(()=>assertOffline(root)).not.toThrow();
});

it('WVA-02 releases the writer when Site initialization fails after opening its database', () => {
  const root=join(base,'failed-site'),site=new Site(root);
  site.store.raw.prepare("UPDATE records SET data='{' WHERE scope='settings' AND id='site'").run();site.close();
  expect(()=>new Site(root)).toThrow();
  expect(()=>assertOffline(root)).not.toThrow();
});
