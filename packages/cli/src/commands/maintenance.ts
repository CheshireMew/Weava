import { restoreBackup, verifyBackup } from '@weava/core';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Site, withInstanceMaintenance, recoverRestore } from '@weava/core';
import { compactDatabase } from '../../../core/src/history-archive.ts';
import {
  selectedProgram,
  checkProgramUpgrade,
  applyProgramUpgrade,
  recoverProgramUpgrade,
  verifyProgram,
} from '../../../core/src/programs.ts';
import type { CliContext } from '../context.ts';

export function registerMaintenanceCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
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

  const extensions = program.command('extensions');

  extensions.command('list').action(async () => output(await request('extensions')));

  extensions
    .command('usage')
    .requiredOption('--id <id>')
    .action(async (opts) =>
      output(await request('extensions/usage?id=' + encodeURIComponent(opts.id))),
    );

  extensions
    .command('enable')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>', '当前设置修订，新设置填 null')
    .action(async (opts) =>
      output(
        await request('extensions/toggle', {
          id: opts.id,
          enabled: true,
          revision: opts.revision === 'null' ? null : Number(opts.revision),
        }),
      ),
    );

  extensions
    .command('disable')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>', '当前设置修订，新设置填 null')
    .action(async (opts) =>
      output(
        await request('extensions/toggle', {
          id: opts.id,
          enabled: false,
          revision: opts.revision === 'null' ? null : Number(opts.revision),
        }),
      ),
    );

  program
    .command('job')
    .requiredOption('--id <id>')
    .option('--cancel','取消等待或正在执行的任务')
    .action(async (opts) => output(opts.cancel?await request('jobs/cancel',{id:opts.id}):await request('job/' + opts.id)));

  program
    .command('logs')
    .requiredOption('--id <id>')
    .option('--offset <offset>', 'UTF-8 字节位置，使用上一响应的 end 继续读取', '0')
    .action(async (opts) =>
      output(await request('logs?id=' + encodeURIComponent(opts.id) + '&offset=' + opts.offset)),
    );

  const backup = program.command('backup');
  backup.command('list').option('--path <path>').action(async options=>output(await request('backup/inventory'+(options.path?'?'+new URLSearchParams({path:resolve(options.path)}):''))));
  backup.command('policy').option('--input <file>','保存包含 value 与 revision 的备份计划').action(async options=>output(await request('backup/policy',options.input?JSON.parse(readFileSync(resolve(options.input),'utf8')):undefined)));

  const upgrade = program.command('upgrade');

  upgrade
    .command('verify')
    .requiredOption('--program <path>')
    .action((opts) => {
      const checked = verifyProgram(resolve(opts.program));
      output({
        root: checked.root,
        id: checked.manifest.id,
        framework: checked.manifest.framework,
        schemaVersion: checked.manifest.schemaVersion,
        files: checked.manifest.files.length,
      });
    });

  upgrade
    .command('check')
    .requiredOption('--program <path>')
    .option('--backup-root <path>', '升级前备份和检查副本', 'D:/Tools/weava/backups')
    .action(async (opts) =>
      output(await checkProgramUpgrade(root(), resolve(opts.program), resolve(opts.backupRoot))),
    );

  upgrade
    .command('apply')
    .requiredOption('--input <file>', '升级预检返回的计划文件')
    .action(async (opts) => {
      const plan = JSON.parse(readFileSync(resolve(opts.input), 'utf8'));
      if (plan.target !== root()) throw new Error('升级计划与当前站点不匹配。');
      output(await applyProgramUpgrade(plan));
    });

  upgrade.command('recover').action(() => output(recoverProgramUpgrade(root())));

  upgrade
    .command('rollback')
    .requiredOption('--restore-data', '恢复升级前备份，升级后的资料保留在 retained 目录')
    .action(() => output(recoverProgramUpgrade(root(), true)));

  upgrade.command('status').action(() => {
    const selected = selectedProgram(root());
    output(
      selected
        ? {
            id: selected.manifest.id,
            framework: selected.manifest.framework,
            root: selected.root,
            schemaVersion: selected.manifest.schemaVersion,
          }
        : { selected: false, framework },
    );
  });

  const maintenance = program.command('maintenance');

  maintenance.command('scan').description('扫描文件及历史引用，更新空间用量')
    .option('--wait')
    .action(async (opts) => output(await wait(await request('maintenance/scan',{}),!!opts.wait)));

  maintenance
    .command('preview')
    .requiredOption('--before <date>')
    .option('--keep-releases <count>', '至少保留公开版本数', '20')
    .option('--keep-revisions <count>', '每个对象至少保留修订数', '20')
    .action(async (opts) =>
      output(
        await request('maintenance/preview', {
          before: opts.before,
          keepReleases: Number(opts.keepReleases),
          keepRevisions: Number(opts.keepRevisions),
        }),
      ),
    );

  maintenance
    .command('archive')
    .requiredOption('--input <file>', '预检结果 JSON')
    .option('--wait')
    .action(async (opts) => {
      const plan = JSON.parse(readFileSync(resolve(opts.input), 'utf8'));
      output(
        await wait(
          await request('maintenance/archive', { options: plan.options, review: plan.review }),
          !!opts.wait,
        ),
      );
    });

  maintenance.command('archives').action(async () => output(await request('maintenance/archives')));
  maintenance.command('temporary').action(async()=>output(await request('maintenance/temporary')));
  maintenance.command('cleanup-temporary').requiredOption('--review <review>','maintenance temporary 返回的预检标识').requiredOption('--confirm','确认删除该预检清单中的暂存文件').action(async opts=>output(await request('maintenance/temporary/cleanup',{review:opts.review,confirm:!!opts.confirm})));

  maintenance
    .command('inspect')
    .requiredOption('--id <id>')
    .action(async (opts) =>
      output(await request('maintenance/archive?id=' + encodeURIComponent(opts.id))),
    );

  maintenance
    .command('restore')
    .requiredOption('--id <id>')
    .option('--wait')
    .action(async (opts) =>
      output(await wait(await request('maintenance/restore', { id: opts.id }), !!opts.wait)),
    );

  maintenance.command('compact').action(async () =>
    withInstanceMaintenance(root(), async () => {
      const site = new Site(root());
      try {
        output(await compactDatabase(site));
      } finally {
        site.close();
      }
    }),
  );

  backup.command('recover').action(async () => output(await recoverRestore(root())));
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
}
