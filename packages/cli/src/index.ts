#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  Site,
  assertOffline,
  restoreBackup,
  verifyBackup,
  recoverRestore,
  atomicJson,
  now,
} from '@weava/core';
import { seedDemo } from '../../core/src/demo.ts';
import { migrateCrypto } from '../../core/src/migrate.ts';
const framework =
  process.env.WEAVA_FRAMEWORK ??
  (import.meta.dirname.endsWith('dist')
    ? resolve(import.meta.dirname, '..')
    : resolve(import.meta.dirname, '../../..'));
const program = new Command()
  .name('weava')
  .version('0.1.0')
  .option('--site <path>', '站点目录', resolve(framework, '../WeavaSites/demo'))
  .option('--url <url>', '运行中的服务地址')
  .option('--human', '人工阅读格式');
function output(value: any) {
  console.log(JSON.stringify(value, null, program.opts().human ? 2 : 0));
}
function root() {
  return resolve(program.opts().site);
}
async function request(action: string, data?: any) {
  const config = existsSync(join(root(), 'site.json'))
    ? JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'))
    : {};
  const url = program.opts().url ?? `http://127.0.0.1:${config.port ?? 4322}`;
  const token = readFileSync(join(root(), 'cli-token'), 'utf8');
  const response = await fetch(url + '/api/admin/v1/' + action, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function wait(job: any, enabled: boolean) {
  if (!enabled) return job;
  const end = Date.now() + 1800000;
  while (['queued', 'running'].includes(job.status)) {
    if (Date.now() > end) {
      process.exitCode = 2;
      return job;
    }
    await new Promise((r) => setTimeout(r, 500));
    job = await request('job/' + job.id);
  }
  if (job.status !== 'complete') process.exitCode = 1;
  return job;
}
program
  .command('init')
  .option('--password-file <file>')
  .option('--demo')
  .option('--port <port>', '端口', '4322')
  .action(async (opts) => {
    assertOffline(root());
    const fresh = !existsSync(join(root(), 'weava.sqlite'));
    const site = new Site(root());
    try {
      if (fresh && Number(opts.port) !== 4322) {
        const settings = site.settings();
        site.saveSettings(
          { ...settings.value, domain: `http://localhost:${Number(opts.port)}` },
          settings.revision,
        );
      }
      if (opts.passwordFile) site.setOwner(readFileSync(opts.passwordFile, 'utf8').trim());
      if (opts.demo) {
        mkdirSync(join(root(), 'media'), { recursive: true });
        writeFileSync(
          join(root(), 'media', 'demo-landscape.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#dce6d8"/><circle cx="920" cy="180" r="80" fill="#f6eed1"/><path d="M0 600 380 180 760 650 1200 270V700H0Z" fill="#829e80"/><path d="M0 700 430 390 750 700 1200 440V700Z" fill="#315c4c"/></svg>',
        );
        seedDemo(site);
      }
      if (!site.store.list('type').length)
        site.saveType(
          { id: 'post', label: '文章', pathPrefix: '/posts/', template: 'article', fields: [] },
          null,
        );
      atomicJson(join(root(), 'site.json'), { version: 1, port: Number(opts.port) });
      output({ site: root(), ownerInitialized: site.ownerExists() });
    } finally {
      site.close();
    }
  });
for (const mode of ['dev', 'start'])
  program
    .command(mode)
    .option('--port <port>')
    .action((opts) => {
      assertOffline(root());
      const config = JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'));
      const port = String(opts.port ?? config.port ?? 4322);
      const args =
        mode === 'dev'
          ? [join(framework, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', port]
          : [join(framework, 'apps/web/dist/server/entry.mjs')];
      const child = spawn(process.execPath, args, {
        cwd: mode === 'dev' ? join(framework, 'apps/web') : framework,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          WEAVA_FRAMEWORK: framework,
          WEAVA_SITE: root(),
          PORT: port,
          HOST: process.env.HOST ?? '127.0.0.1',
          ASTRO_TELEMETRY_DISABLED: '1',
        },
      });
      child.on('exit', (code) => {
        process.exitCode = code ?? 1;
      });
      process.on('SIGINT', () => child.kill('SIGINT'));
    });
program.command('build').action(() => {
  const child = spawn(process.execPath, ['--import', 'tsx', join(framework, 'scripts/build.ts')], {
    cwd: framework,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, WEAVA_SITE: root() },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
});
program
  .command('status')
  .option('--storage')
  .action(async (opts) =>
    output(
      opts.storage
        ? await request('maintenance')
        : await request('state').then((s) => ({
            site: root(),
            entries: s.entries.length,
            jobs: s.jobs,
            releases: s.releases,
          })),
    ),
  );
for (const name of ['content', 'page', 'settings', 'media']) {
  const command = program.command(name);
  command
    .command('list')
    .action(async () =>
      output(
        await request(name === 'settings' ? 'settings' : name === 'media' ? 'media' : 'entries'),
      ),
    );
  command
    .command('save')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await wait(
          await request(
            name === 'settings' ? 'settings' : name === 'media' ? 'media' : 'entry',
            JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
          ),
          name === 'media',
        ),
      ),
    );
}
program
  .command('publish')
  .option('--id <id...>')
  .option('--wait')
  .action(async (opts) =>
    output(await wait(await request('publish', { ids: opts.id }), !!opts.wait)),
  );
program
  .command('rollback')
  .requiredOption('--id <id>')
  .action(async (opts) => output(await request('rollback', { id: opts.id })));
program
  .command('job')
  .requiredOption('--id <id>')
  .action(async (opts) => output(await request('job/' + opts.id)));
program
  .command('logs')
  .requiredOption('--id <id>')
  .option('--offset <offset>', '字符位置', '0')
  .action(async (opts) =>
    output(await request('logs?id=' + encodeURIComponent(opts.id) + '&offset=' + opts.offset)),
  );
const backup = program.command('backup');
backup
  .command('create')
  .option('--path <path>', '备份根目录', 'D:/Tools/weava/backups')
  .option('--wait')
  .action(async (opts) =>
    output(await wait(await request('backup', { path: resolve(opts.path) }), !!opts.wait)),
  );
backup
  .command('verify')
  .requiredOption('--path <path>')
  .action((opts) => output(verifyBackup(resolve(opts.path))));
backup
  .command('restore')
  .requiredOption('--path <path>')
  .option('--backup-root <path>', '恢复前备份位置', 'D:/Tools/weava/backups')
  .action(async (opts) =>
    output(await restoreBackup(resolve(opts.path), root(), resolve(opts.backupRoot))),
  );
backup.command('recover').action(() => output(recoverRestore(root())));
program
  .command('export')
  .requiredOption('--output <file>')
  .action(async (opts) => {
    const data = await request('export');
    writeFileSync(resolve(opts.output), JSON.stringify(data, null, 2));
    output({ path: resolve(opts.output) });
  });
program
  .command('import')
  .requiredOption('--input <file>')
  .action(async (opts) => {
    const data = JSON.parse(readFileSync(resolve(opts.input), 'utf8'));
    for (const t of data.types ?? []) await request('types', { value: t, revision: null });
    for (const e of data.entries ?? []) await request('entry', { value: e, revision: null });
    output({ imported: data.entries?.length ?? 0 });
  });
program
  .command('owner')
  .command('reset-password')
  .requiredOption('--password-file <file>')
  .action((opts) => {
    assertOffline(root());
    const site = new Site(root());
    try {
      site.setOwner(readFileSync(resolve(opts.passwordFile), 'utf8').trim());
      output({ updated: true });
    } finally {
      site.close();
    }
  });
program
  .command('migrate')
  .command('crypto')
  .requiredOption('--source <path>')
  .requiredOption('--capture <path>')
  .option('--dry-run')
  .action(async (opts) => {
    assertOffline(root());
    output(await migrateCrypto(resolve(opts.source), root(), resolve(opts.capture), !!opts.dryRun));
  });
try {
  await program.parseAsync();
} catch (error: any) {
  output({ error: error.message, details: error.details });
  process.exitCode = 1;
}
