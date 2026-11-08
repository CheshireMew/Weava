import {join,relative,resolve} from 'node:path';
import {existsSync,mkdirSync,readFileSync,copyFileSync,renameSync,lstatSync} from 'node:fs';
import Database from 'better-sqlite3';
import {walk,atomicJson} from '../../runtime-common/src/files.ts';
import {uuid,now} from '../../runtime-common/src/identity.ts';
import {inside} from '../../runtime-common/src/paths.ts';
import {Site} from './site.ts';
import {WeavaError,VERSION} from '@weava/contracts';
import {assertMaintenanceAvailable,withInstanceMaintenance} from './instance-access.ts';
import {pathWithin} from './paths.ts';
import {digestFile} from './file-io.ts';
import {siteFiles} from './site-files.ts';
import {repairSiteBuildLink} from './build-links.ts';
import {siteRoutes} from './site-routes.ts';
import {loadSiteRenderer} from './site-render.ts';
import {BusinessStore,websiteContext} from './site-sdk.ts';
import {migrateWebsite} from './site-migrations.ts';

async function validateRestoredSite(root:string){
  const routes=siteRoutes(root);
  if(routes.build){
    const {selectedProgram}=await import('./programs.ts');
    const program=selectedProgram(root);
    if(!program)throw new WeavaError('请先准备备份所选的程序，再恢复网站。');
    repairSiteBuildLink(root,routes.build.manifest.id,program.root);
  }
  const site=new Site(root);
  try{
    // Upload bytes are deliberately excluded from an online backup. Never claim
    // that the copied offsets can resume without the corresponding staged file.
    const uploads=site.store.raw.prepare("SELECT id,job_id FROM media_uploads WHERE status IN ('receiving','processing')").all() as {id:string;job_id:string|null}[];
    site.store.raw.transaction(()=>{
      for(const upload of uploads){
        site.store.raw.prepare("UPDATE media_uploads SET status='expired',expires=0,offset=0,lease=NULL,lease_until=0 WHERE id=?").run(upload.id);
        if(upload.job_id){const job=site.job(upload.job_id);if(['queued','running'].includes(job.status))site.updateJob(job.id,{status:'failed',workerPid:undefined,errorStatus:409,message:'网站已从备份恢复，请重新选择文件上传。'});}
      }
      // Request spools share the excluded upload staging area. A restored job
      // cannot execute against an absent file or retain a lease from the old process.
      for(const request of site.store.raw.prepare('SELECT job_id FROM staged_requests').all() as {job_id:string|null}[]){
        if(request.job_id){const job=site.job(request.job_id);if(['queued','running'].includes(job.status))site.updateJob(job.id,{status:'failed',workerPid:undefined,errorStatus:409,message:'网站已从备份恢复，请重新选择导入文件。'});}
      }
      site.store.raw.prepare('UPDATE staged_requests SET active_until=0,expires=0').run();
    }).immediate();
    if(site.store.raw.pragma('integrity_check',{simple:true})!=='ok')throw new WeavaError('恢复数据库校验失败。');
    if(routes.build){
      await migrateWebsite(root,routes.build.manifest.id,'open');
      const renderer=await loadSiteRenderer(root);
      const business=new BusinessStore(root,existsSync(join(root,'business.sqlite'))?'open':'migrate');
      try{
        const paths=new Set(['/',...routes.paths,...(site.visibleRelease()?.entries.map(entry=>entry.path)??[])]);
        for(const path of paths){
          const request=new Request(new URL(path,site.settings().value.domain));
          const response=await renderer!.render(request,websiteContext(site,business,{enqueue(){throw new Error('恢复检查不执行持久任务。');}},request,true));
          if(response&&response.status>=500)throw new WeavaError('恢复后专用页面无法运行：'+path);
          await response?.body?.cancel();
        }
      }finally{business.close();}
    }
  }finally{site.close();}
}
export async function createBackup(site: Site, base: string, label = '手动备份') {
  const root = resolve(base);
  if (pathWithin(site.root, root))
    throw new WeavaError('备份目录必须在站点外。');
  const id = now().replace(/[:.]/g, '-') + '-' + uuid().slice(0, 8),
    folder = join(root, id);
  mkdirSync(folder, { recursive: true });
  await site.store.raw.backup(join(folder, 'weava.sqlite'));
  const analytics = join(site.root, 'analytics.sqlite');
  if (existsSync(analytics)) {
    const db = new Database(analytics);
    try {
      await db.backup(join(folder, 'analytics.sqlite'));
    } finally {
      db.close();
    }
  }
  const business=join(site.root,'business.sqlite');
  if(existsSync(business)){const db=new Database(business);try{await db.backup(join(folder,'business.sqlite'));}finally{db.close();}}
    for (const file of siteFiles(site.root)) {
      const target = join(folder, relative(site.root, file));
      mkdirSync(resolve(target, '..'), { recursive: true });
      copyFileSync(file, target);
    }
  const files = walk(folder).map((file) => ({
    path: relative(folder, file).replaceAll('\\', '/'),
    hash: digestFile(file),
  }));
  const manifest = { version: 1, framework: VERSION, id, createdAt: now(), label, files };
  atomicJson(join(folder, 'manifest.json'), manifest);
  return { id, path: folder, files: files.length };
}
export function verifyBackup(folder: string) {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new WeavaError('备份清单格式无效。');
  const paths = new Set<string>();
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || item.path.includes('\\') ||
      item.path.split('/').some((part: string) => !part || part === '.' || part === '..') ||
      typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || paths.has(item.path.toLowerCase()))
      throw new WeavaError('备份清单包含无效或重复文件。');
    paths.add(item.path.toLowerCase());
    const file = inside(folder, item.path);
    if (
      !existsSync(file) ||
      lstatSync(file).isSymbolicLink() ||
      digestFile(file) !== item.hash
    )
      throw new WeavaError('备份校验失败：' + item.path);
  }
  if (!manifest.files.some((item: { path: string }) => item.path === 'weava.sqlite'))
    throw new WeavaError('备份清单缺少站点数据库。');
  verifyDatabase(join(folder, 'weava.sqlite'));
  return manifest;
}
function verifyDatabase(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    if (['records', 'revisions', 'releases', 'state', 'schema_migrations'].some((name) => !tables.has(name)) ||
      db.pragma('integrity_check', { simple: true }) !== 'ok') throw new WeavaError('备份数据库结构或完整性无效。');
  } finally { db.close(); }
}
export function copyVerifiedBackup(folder: string, target: string) {
  const manifest = verifyBackup(folder);
  mkdirSync(target, { recursive: true });
  for (const item of manifest.files as { path: string; hash: string }[]) {
    const destination = inside(target, item.path);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(inside(folder, item.path), destination);
    if (digestFile(destination) !== item.hash) throw new WeavaError('复制期间备份文件发生变化：' + item.path);
  }
  verifyDatabase(join(target, 'weava.sqlite'));
}
export async function restoreBackup(folder: string, target: string, backupRoot: string) {
  verifyBackup(folder);
  return withInstanceMaintenance(target, async () => {
  await recoverRestore(target);
  if (existsSync(join(target, 'weava.sqlite'))) {
    const site = new Site(target);
    try {
      await createBackup(site, backupRoot, '恢复前自动备份');
    } finally {
      site.close();
    }
  }
  const staging = target + '.restore-' + uuid();
  copyVerifiedBackup(folder, staging);
  await validateRestoredSite(staging);
  const journal = target + '.restore.json';
  atomicJson(journal, {
    target,
    staging,
    backup: target + '.retained-' + Date.now(),
    status: 'prepared',
  });
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (existsSync(target)) renameSync(target, state.backup);
  atomicJson(journal, { ...state, status: 'displaced' });
  try {
    renameSync(staging, target);
  } catch (error) {
    if (existsSync(state.backup)) renameSync(state.backup, target);
    atomicJson(journal, { ...state, status: 'rolled_back' });
    throw error;
  }
  atomicJson(journal, { ...state, status: 'complete' });
  return { restored: true, target, retained: state.backup };
  });
}
export async function recoverRestore(target: string) {
  const journal = target + '.restore.json';
  if (!existsSync(journal)) return { recovered: false };
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (!['prepared', 'displaced'].includes(state.status)) return { recovered: false };
  if (
    state.target !== target ||
    !state.staging?.startsWith(target + '.restore-') ||
    !state.backup?.startsWith(target + '.retained-')
  )
    throw new WeavaError('恢复日志路径无效，请检查：' + journal);
  return withInstanceMaintenance(target, async () => {
  if (!existsSync(target) && existsSync(state.backup)) renameSync(state.backup, target);
  else if (!existsSync(target) && existsSync(state.staging)) renameSync(state.staging, target);
  if (!existsSync(join(target, 'weava.sqlite')))
    throw new WeavaError('恢复尚未完成，缺少站点数据库。');
  const db = new Database(join(target, 'weava.sqlite'));
  try {
    const check = db.pragma('integrity_check') as any[];
    if (check.some((r) => Object.values(r)[0] !== 'ok'))
      throw new WeavaError('恢复数据库校验失败。');
  } finally {
    db.close();
  }
  await validateRestoredSite(target);
  atomicJson(journal, { ...state, status: 'recovered' });
  return { recovered: true, target };
  });
}
export function assertOffline(root: string) {
  assertMaintenanceAvailable(root);
}
