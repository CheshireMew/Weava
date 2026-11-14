import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Site } from '../packages/core/src/site.ts';
import { JobRunner } from '../packages/core/src/job-runner.ts';
import { createBackup, restoreBackup, verifyBackup } from '../packages/core/src/backup.ts';
import { executeManagedJob } from '../packages/core/src/managed-jobs.ts';
import { queueAutomaticBackup, saveBackupPolicy } from '../packages/core/src/backup-management.ts';
import { beginMediaUpload, receiveMediaChunk, finishMediaUpload, completeMediaUpload, mediaUploadStatus } from '../packages/core/src/media-upload.ts';
import { prepareMedia } from '../packages/core/src/media.ts';
import { fixtureProgram } from './fixtures/managed-program.ts';
import { atomic, json, updateInstallation } from '../packages/manager/src/state.ts';
import { requestHost } from '../packages/manager/src/host.ts';
import { maintenance, proxyDirectory } from '../packages/manager/src/proxy.ts';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const base = join(process.env.WEAVA_TEST_OUTPUT ?? 'D:/Tools/cache/weava/tests', 'recovery-boundaries-' + randomUUID());
const entry = process.env.WEAVA_TEST_WEB_ENTRY;
if (process.env.WEAVA_REQUIRE_RECOVERY_HTTP === '1' && !entry) throw new Error('恢复验证需要当前源码的 HTTP 编译入口。');
const sites: Site[] = [], runners: JobRunner[] = [];
const create = (name: string) => { const site = new Site(join(base, name)); sites.push(site); return site; };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const runner of runners.splice(0)) {
    runner.stop();
    for (let n = 0; runner.queryProcessCount && n < 100; n++) await delay(50);
    expect(runner.queryProcessCount).toBe(0);
  }
  for (const site of sites.splice(0)) site.close();
});
async function upload(site: Site, text: string) {
  const session = beginMediaUpload(site, 'recovery.txt', Buffer.byteLength(text), undefined, sha(text));
  await receiveMediaChunk(site, session.id, 0, new Request('http://localhost/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: text,
  }));
  const job = finishMediaUpload(site, { enqueue: (operation, payload, key) => site.createJob(operation, payload, key) }, session.id);
  return { session, job, staging: join(site.root, 'uploads', session.id + '.bin') };
}

it('WVA-A01 includes public resources and keeps shared dependencies and caches outside the backup', async () => {
  const site = create('asset-source'), build = join(site.root, 'site-builds/one'), shared = join(base, 'shared');
  mkdirSync(join(site.root, 'public/icons'), { recursive: true });
  writeFileSync(join(site.root, 'public/icons/logo.svg'), '<svg>owned resource</svg>');
  mkdirSync(join(build, 'cache'), { recursive: true }); mkdirSync(shared, { recursive: true });
  mkdirSync(join(site.root, 'custom/.astro'), { recursive: true });
  atomic(join(build, 'site-build.json'), { id: 'one', dependencyReference: 'node_modules' });
  writeFileSync(join(build, 'entry.mjs'), 'export {};'); writeFileSync(join(build, 'cache/cache.bin'), 'cache');
  writeFileSync(join(shared, 'dependency.txt'), 'shared'); writeFileSync(join(site.root, 'custom/.astro/cache'), 'cache');
  symlinkSync(shared, join(build, 'node_modules'), 'junction');
  const backup = await createBackup(site, join(base, 'asset-backups'));
  const paths = verifyBackup(backup.path).files.map((file: { path: string }) => file.path);
  expect(paths).toContain('public/icons/logo.svg'); expect(paths).toContain('site-builds/one/entry.mjs');
  expect(paths.some((path: string) => /node_modules|\/cache\/|custom\/\.astro/.test(path))).toBe(false);
  const target = join(base, 'asset-restored'); await restoreBackup(backup.path, target, join(base, 'before'));
  expect(readFileSync(join(target, 'public/icons/logo.svg'), 'utf8')).toBe('<svg>owned resource</svg>');
  expect(readFileSync(join(shared, 'dependency.txt'), 'utf8')).toBe('shared');
});

it('WVA-A03 detaches copied commands while the source process lives and completes new automatic and queued backups', async () => {
  const source = create('jobs-source');
  const pending = source.createJob('import-json', { mustNotReplay: true }); source.updateJob(pending.id, { managed: true });
  const job = source.createJob('backup', { path: join(base, 'source-backups') });
  source.updateJob(job.id, { status: 'running', managed: true, workerPid: process.pid, heartbeatAt: Date.now(), deadlineAt: Date.now() + 60000 });
  source.recoverJobs(); expect(source.job(job.id).status).toBe('running'); expect(source.job(pending.id).status).toBe('queued');
  const backup = await executeManagedJob(source, source.job(job.id), async () => { throw new Error('Backup must not load content extensions'); }) as { path: string };
  const target = join(base, 'jobs-restored'); await restoreBackup(backup.path, target, join(base, 'before'));
  const restored = new Site(target); sites.push(restored); restored.recoverJobs();
  expect(source.job(job.id).status).toBe('complete'); expect(source.job(pending.id).status).toBe('queued');
  for (const id of [job.id, pending.id]) {
    expect(restored.job(id).status).toBe('failed'); expect(restored.job(id).workerPid).toBeUndefined();
    expect(restored.job(id).heartbeatAt).toBeUndefined(); expect(restored.job(id).deadlineAt).toBeUndefined();
  }
  const runner = new JobRunner(restored, { framework: resolve('.'), source: true, startPaused: false }); runners.push(runner);
  saveBackupPolicy(restored, { enabled: true, path: join(base, 'restored-backups'), time: '00:00' }, null);
  const automatic = queueAutomaticBackup(restored, runner, Date.now() + 86400000)!; expect(automatic).not.toBeNull();
  const result = await runner.wait(automatic.id, 15000); expect(verifyBackup(result.path).files.length).toBeGreaterThan(0);
  const verify = runner.enqueue('verify', { path: result.path }); await runner.wait(verify.id, 15000);
  expect(restored.job(verify.id).status).toBe('complete'); expect(restored.activeJobs()).toEqual([]);
}, 30000);

it.each(['before-intent', 'before-move', 'after-move', 'after-record'] as const)('WVA-A04 resumes the same upload across %s interruption', async phase => {
  const site = create('upload-' + phase), text = 'same bytes after ' + phase;
  const { session, job, staging } = await upload(site, text);
  const rename = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;
  if (phase === 'before-intent') site.store.raw.exec("CREATE TRIGGER fail_path BEFORE UPDATE OF path ON media_uploads BEGIN SELECT RAISE(ABORT,'interruption'); END");
  else if (phase === 'after-record') vi.spyOn(site.store, 'put').mockImplementationOnce(() => { throw new Error('interruption'); });
  else vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
    if (phase === 'after-move') await rename(from, to);
    throw new Error('interruption');
  });
  await expect(completeMediaUpload(site, session.id, job.id)).rejects.toThrow('interruption');
  if (phase === 'before-intent') site.store.raw.exec('DROP TRIGGER fail_path');
  vi.restoreAllMocks();
  expect(site.store.list('media')).toHaveLength(0);
  expect(existsSync(staging)).toBe(['before-intent', 'before-move'].includes(phase));
  const row = await completeMediaUpload(site, session.id, job.id);
  expect(readFileSync(join(site.root, row.value.url.slice(1)), 'utf8')).toBe(text);
  expect(mediaUploadStatus(site, session.id).status).toBe('complete'); expect(site.store.list('media')).toHaveLength(1);
  expect((await completeMediaUpload(site, session.id, job.id)).id).toBe(row.id);
  expect(site.store.list('media')).toHaveLength(1);
});

it('WVA-A04 recovers old moved uploads and rejects a mismatched durable file', async () => {
  for (const corrupt of [false, true]) {
    const site = create('legacy-upload-' + corrupt), text = 'legacy interruption ' + corrupt;
    const { session, job, staging } = await upload(site, text);
    site.store.raw.prepare('UPDATE media_uploads SET verified=1 WHERE id=?').run(session.id);
    // The old producer really moved the bytes, but never saved a media record or receipt.
    const prepared = await prepareMedia(site, staging, 'recovery.txt', { hash: sha(text), move: true, optimize: false });
    const file = join(site.root, prepared.value.url.slice(1));
    if (corrupt) {
      writeFileSync(file, 'different bytes');
      await expect(completeMediaUpload(site, session.id, job.id)).rejects.toThrow(/校验失败/);
      expect(site.store.list('media')).toHaveLength(0); expect(readFileSync(file, 'utf8')).toBe('different bytes');
    } else {
      const row = await completeMediaUpload(site, session.id, job.id);
      expect(row.id).toBe(prepared.id); expect(readFileSync(file, 'utf8')).toBe(text);
      expect(mediaUploadStatus(site, session.id).status).toBe('complete');
    }
  }
});

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function stop(child: ChildProcess, action?: () => Promise<unknown>) {
  if (action) await action().catch(() => {});
  else if (child.connected) child.send({ type: 'weava-control', action: 'shutdown' });
  if (child.exitCode === null) {
    await Promise.race([once(child, 'exit'), delay(5000)]);
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
}
async function withHttp(root: string, run: (origin: string) => Promise<void>) {
  const port = await freePort(), origin = 'http://127.0.0.1:' + port;
  atomic(join(root, 'site.json'), { version: 2, id: 'recovery', port, features: ['media'], template: 'blank' });
  const child = spawn(process.execPath, [entry!], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEAVA_SITE: root, WEAVA_FRAMEWORK: process.cwd(), WEAVA_SOURCE_WORKER: '1', WEAVA_DATABASE_MODE: 'open', WEAVA_VALIDATION: '0', HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' } });
  let output = ''; child.stdout!.on('data', b => output = (output + b).slice(-12000)); child.stderr!.on('data', b => output = (output + b).slice(-12000));
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw new Error(output);
      try { const r = await fetch(origin + '/__health', { signal: AbortSignal.timeout(1000) }); await r.body?.cancel(); if (r.ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    expect(ready, output).toBe(true); await run(origin);
  } finally { await stop(child); }
}

describe('recovery through the current HTTP server', { skip: !entry }, () => {
  it('WVA-A01 and WVA-A04 serve restored public assets and recovered upload bytes through real HTTP routes', async () => {
    const source = create('http-source'); mkdirSync(join(source.root, 'public'), { recursive: true });
    writeFileSync(join(source.root, 'public/owned.txt'), 'site asset after restore');
    const backup = await createBackup(source, join(base, 'http-backups')), target = join(base, 'http-restored');
    await restoreBackup(backup.path, target, join(base, 'before'));
    const restored = new Site(target); sites.push(restored);
    const text = 'media bytes after interruption', { session, job } = await upload(restored, text);
    vi.spyOn(restored.store, 'put').mockImplementationOnce(() => { throw new Error('interrupted commit'); });
    await expect(completeMediaUpload(restored, session.id, job.id)).rejects.toThrow('interrupted commit'); vi.restoreAllMocks();
    const row = await completeMediaUpload(restored, session.id, job.id); restored.updateJob(job.id, { status: 'complete', result: row });
    await withHttp(target, async origin => {
      const asset = await fetch(origin + '/site-assets/owned.txt'); expect(asset.status).toBe(200); expect(await asset.text()).toBe('site asset after restore');
      const media = await fetch(origin + row.value.url); expect(media.status).toBe(200); expect(await media.text()).toBe(text);
    });
  }, 30000);

  it.each(['activating', 'activation-failed'])('WVA-A02 recovers a stopped %s instance through the real host without losing post-activation data', async status => {
    const home = join(base, 'host-' + status), program = fixtureProgram(home, 'await import(' + JSON.stringify(pathToFileURL(entry!).href) + ');');
    const site = new Site(join(home, 'site')); sites.push(site);
    const port = await freePort(), origin = 'http://127.0.0.1:' + port, operation = randomUUID();
    const settings = site.settings(); site.saveSettings({ ...settings.value, name: 'Saved after activation', domain: origin }, settings.revision);
    atomic(join(site.root, 'site.json'), { version: 2, id: 'blog', port, features: [], template: 'blank' });
    atomic(join(site.root, 'program.json'), { version: 2, programId: program.manifest.id, manifestHash: program.manifestHash, installationRoot: home, selectedAt: new Date().toISOString() });
    updateInstallation(home, value => { value.sites.blog = { root: site.root, autostart: false }; });
    atomic(join(site.root, '.weava-preparation.json'), { version: 1, operation, status: 'activation-failed' });
    atomic(join(site.root, '.weava-update.json'), { status, writesEnabled: true, online: { operation }, point: join(home, 'must-not-restore'), programId: 'old' });
    maintenance(home, 'blog', true, operation);
    const child = spawn(process.execPath, ['--import', 'tsx', 'packages/manager/src/index.ts', '--installation', home, 'host', 'run'], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout!.on('data', b => output = (output + b).slice(-12000)); child.stderr!.on('data', b => output = (output + b).slice(-12000));
    try {
      let ready = false;
      for (let n = 0; n < 100; n++) {
        if (child.exitCode !== null) throw new Error(output);
        try { await requestHost(home, 'status', { timeoutMs: 1000 }); ready = true; break; } catch {} await delay(100);
      }
      expect(ready, output).toBe(true);
      await expect(requestHost(home, 'start', { id: 'blog' })).rejects.toThrow(/site recover/);
      const recovery = await promisify(execFile)(process.execPath,
        ['--import', 'tsx', 'packages/manager/src/index.ts', '--installation', home, 'site', 'recover', 'blog'],
        { cwd: process.cwd(), windowsHide: true, timeout: 30000 });
      expect(JSON.parse(recovery.stdout)).toMatchObject({ recovered: true, dataPreserved: true });
      expect(site.settings().value.name).toBe('Saved after activation');
      expect(json(join(site.root, '.weava-update.json')).status).toBe('complete');
      expect(existsSync(join(proxyDirectory(home, 'blog'), 'active.json'))).toBe(false);
      const response = await fetch(origin + '/'); expect(response.status).toBe(200); await response.body?.cancel();
      const headers = { Authorization: 'Bearer ' + site.cliToken() };
      const saved = await fetch(origin + '/api/admin/v1/settings', { headers }); expect(saved.status).toBe(200);
      expect((await saved.json()).value.name).toBe('Saved after activation');
      await requestHost(home, 'stop', { id: 'blog' }); await requestHost(home, 'start', { id: 'blog' });
      const reopened = await fetch(origin + '/api/admin/v1/settings', { headers }); expect((await reopened.json()).value.name).toBe('Saved after activation');
    } finally { await stop(child, () => requestHost(home, 'shutdown', { timeoutMs: 5000 })); }
  }, 45000);
});
