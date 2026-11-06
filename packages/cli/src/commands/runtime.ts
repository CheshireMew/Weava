import { resolve, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readOwnerPassword } from '../owner-input.ts';
import { announceOwnerAccess } from '../owner-links.ts';
import { Site, assertServiceStopped, withInstanceMaintenance, atomicJson } from '@weava/core';
import { seedDemo } from '../../../core/src/demo.ts';
import { selectedProgram, defaultProgram, verifyProgram } from '../../../core/src/programs.ts';
import type { CliContext } from '../context.ts';

export function registerRuntimeCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  program
    .command('init')
    .option('--password-file <file>')
    .option('--username <name>', '站主账户名', 'owner')
    .option('--demo')
    .option('--port <port>', '端口', '4322')
    .action(async (opts) => {
      const assertUnmanaged = () => {
        for (const name of ['site.json', 'program.json']) {
          const file = join(root(), name);
          if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).version === 2)
            throw new Error(
              '这个网站已由托管器管理，不能再次初始化；请使用 site update、site recover 或 owner 命令。',
            );
        }
      };
      assertUnmanaged();
      return withInstanceMaintenance(root(), async () => {
        assertUnmanaged();
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
          if (opts.passwordFile) {
            if (site.ownerExists())
              throw new Error('账户已经初始化，请使用 owner recover 或 reset-password。');
            site.auth.recoverAccount(opts.username, await readOwnerPassword(opts.passwordFile));
          }
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
    });

  for (const mode of ['dev', 'start'])
    program
      .command(mode)
      .option('--port <port>')
      .action((opts) => {
        assertServiceStopped(root());
        const config = JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'));
        const port = String(opts.port ?? config.port ?? 4322);
        const selected =
          mode === 'start'
            ? (selectedProgram(root()) ??
              (bundledProgram ? verifyProgram(bundledProgram) : defaultProgram(framework)))
            : null;
        const args =
          mode === 'dev'
            ? [join(framework, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', port]
            : [
                selected
                  ? join(selected.root, 'web/server/entry.mjs')
                  : join(framework, 'apps/web/dist/server/entry.mjs'),
              ];
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
            ...(selected
              ? {
                  WEAVA_PROGRAM_ROOT: selected.root,
                  WEAVA_ADMIN_DIST: join(selected.root, 'admin'),
                  WEAVA_WORKER: join(selected.root, 'runtime/worker.mjs'),
                  WEAVA_SOURCE_WORKER: '0',
                }
              : {}),
          },
        });
        child.on('exit', (code) => {
          process.exitCode = code ?? 1;
        });
        process.on('SIGINT', () => child.kill('SIGINT'));
        void announceOwnerAccess(
          root(),
          port,
          program.opts().url,
          () => child.exitCode === null && !child.killed,
          (text) => console.log(text),
        ).catch(() => console.error('无法显示账户入口，请在本机运行 owner status 查看。'));
      });

  program
    .command('build')
    .option('--output <path>', '独立版本构建目录')
    .action((opts) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', join(framework, 'scripts/build.ts')],
        {
          cwd: framework,
          stdio: 'inherit',
          windowsHide: true,
          env: {
            ...process.env,
            WEAVA_SITE: root(),
            ...(opts.output ? { WEAVA_BUILD_OUTPUT: resolve(opts.output) } : {}),
          },
        },
      );
      child.on('exit', (code) => {
        process.exitCode = code ?? 1;
      });
    });
}
