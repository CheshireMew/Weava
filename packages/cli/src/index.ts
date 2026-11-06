#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { registerDiagnostics } from './diagnostics/index.ts';
import { selectedProgram } from '../../core/src/programs.ts';
import { createCliContext } from './context.ts';
import { registerContentCommands } from './commands/content.ts';
import { registerRuntimeCommands } from './commands/runtime.ts';
import { registerMaintenanceCommands } from './commands/maintenance.ts';
import { registerPublicationCommands } from './commands/publication.ts';
import { registerReportsCommands } from './commands/reports.ts';
import { registerOwnerCommands } from './commands/owner.ts';
import { registerMigrationCommands } from './commands/migration.ts';

const bundledProgram =
  import.meta.dirname.endsWith('runtime') &&
  existsSync(join(import.meta.dirname, '..', 'program.json'))
    ? resolve(import.meta.dirname, '..')
    : null;

const framework =
  process.env.WEAVA_FRAMEWORK ??
  bundledProgram ??
  (import.meta.dirname.endsWith('dist')
    ? resolve(import.meta.dirname, '..')
    : resolve(import.meta.dirname, '../../..'));

const program = new Command()
  .name('weava')
  .version('0.2.0')
  .option('--site <path>', '站点目录', resolve(framework, '../WeavaSites/demo'))
  .option('--url <url>', '运行中的服务地址')
  .option('--human', '人工阅读格式');

const context = createCliContext(program, framework, bundledProgram);
const { output } = context;
registerContentCommands(context);
registerRuntimeCommands(context);
registerMaintenanceCommands(context);
registerPublicationCommands(context);
registerReportsCommands(context);
registerOwnerCommands(context);
registerMigrationCommands(context);
registerDiagnostics(program, output);

try {
  const args = process.argv.slice(2);
  const operation = args.find(
    (value, index) =>
      !value.startsWith('-') && args[index - 1] !== '--site' && args[index - 1] !== '--url',
  );
  const siteIndex = args.indexOf('--site'),
    target =
      siteIndex >= 0 ? resolve(args[siteIndex + 1]) : resolve(framework, '../WeavaSites/demo');
  if (
    !process.env.WEAVA_DELEGATED &&
    !['build', 'dev', 'init'].includes(operation ?? '') &&
    existsSync(join(target, 'program.json'))
  ) {
    const selected = selectedProgram(target);
    if (selected && resolve(selected.root) !== resolve(bundledProgram ?? framework)) {
      const child = spawn(process.execPath, [join(selected.root, 'runtime/weava.mjs'), ...args], {
        cwd: selected.root,
        windowsHide: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          WEAVA_DELEGATED: '1',
          WEAVA_FRAMEWORK: selected.root,
          WEAVA_PROGRAM_ROOT: selected.root,
          WEAVA_DATABASE_MODE: 'open',
        },
      });
      const code = await new Promise<number>((resolve) =>
        child.once('exit', (code) => resolve(code ?? 1)),
      );
      process.exitCode = code;
    } else await program.parseAsync();
  } else await program.parseAsync();
} catch (error: any) {
  output({ error: error.message, details: error.details });
  process.exitCode = 1;
}
