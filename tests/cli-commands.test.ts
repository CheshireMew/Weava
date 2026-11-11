import { Command } from 'commander';
import { expect, it, vi } from 'vitest';
import { createCliContext } from '../packages/cli/src/context.ts';
import { registerContentCommands } from '../packages/cli/src/commands/content.ts';
import { registerRuntimeCommands } from '../packages/cli/src/commands/runtime.ts';
import { registerMaintenanceCommands } from '../packages/cli/src/commands/maintenance.ts';
import { registerPublicationCommands } from '../packages/cli/src/commands/publication.ts';
import { registerReportsCommands } from '../packages/cli/src/commands/reports.ts';
import { registerOwnerCommands } from '../packages/cli/src/commands/owner.ts';
import { registerMigrationCommands } from '../packages/cli/src/commands/migration.ts';

function fixture() {
  const program = new Command().name('weava'),
    request = vi.fn(async () => ({ ok: true })),
    output = vi.fn(),
    wait = vi.fn(async (job:unknown, _enabled:boolean) => job);
  const context = { ...createCliContext(program, process.cwd(), null), request, output, wait };
  for (const register of [
    registerContentCommands,
    registerRuntimeCommands,
    registerMaintenanceCommands,
    registerPublicationCommands,
    registerReportsCommands,
    registerOwnerCommands,
    registerMigrationCommands,
  ])
    register(context);
  return { program, request, output, wait };
}
it('retains the public command groups and backup, owner and migration operations after registration is split', () => {
  const { program } = fixture();
  expect(program.commands.map((command) => command.name()).sort()).toEqual(
    [
      'schema',
      'media-upload',
      'media-upload-cancel',
      'content',
      'comments',
      'events',
      'page',
      'settings',
      'media',
      'view',
      'creation-template',
      'export',
      'import',
      'init',
      'dev',
      'start',
      'build',
      'status',
      'extensions',
      'job',
      'logs',
      'backup',
      'upgrade',
      'maintenance',
      'markdown',
      'redirect',
      'publication-plan',
      'publish',
      'publication',
      'rollback',
      'schedule',
      'seo',
      'search-data',
      'analytics',
      'owner',
      'migrate',
    ].sort(),
  );
  const group = (name: string) => program.commands.find((command) => command.name() === name)!;
  expect(
    group('backup')
      .commands.map((command) => command.name())
      .sort(),
  ).toEqual(['create', 'verify', 'restore', 'recover', 'list', 'policy'].sort());
  expect(group('owner').commands.map((command) => command.name())).toEqual(
    expect.arrayContaining([
      'recover',
      'status',
      'reset-password',
      'admin-path',
      'rotate-cli-token',
      'reset-two-factor',
    ]),
  );
  expect(group('migrate').commands.map((command) => command.name())).toEqual(
    expect.arrayContaining(['wxr', 'wordpress', 'wordpress-routes', 'wordpress-statistics']),
  );
});
it('keeps content identifiers encoded and schedule revisions numeric at the command boundary', async () => {
  const first = fixture(),
    id = '中文/entry';
  await first.program.parseAsync(['content', 'get', '--id', id], { from: 'user' });
  expect(first.request).toHaveBeenCalledWith('entry/' + encodeURIComponent(id));
  expect(first.output).toHaveBeenCalledWith({ ok: true });
  const second = fixture();
  await second.program.parseAsync(
    ['schedule', 'create', '--id', 'entry', '--revision', '7', '--at', '2030-01-01T10:00:00+08:00'],
    { from: 'user' },
  );
  expect(second.request).toHaveBeenCalledWith('schedule', {
    id: 'entry',
    revision: 7,
    dueAt: '2030-01-01T10:00:00+08:00',
  });
});

it('previews rollback without writing and submits storage scans through the task API', async () => {
  const rollback = fixture();
  await rollback.program.parseAsync(['rollback','--id','old-release'],{from:'user'});
  expect(rollback.request.mock.calls).toEqual([['rollback/preview',{id:'old-release'}]]);
  expect(rollback.output).toHaveBeenCalledWith({ok:true});
  const scan = fixture();
  await scan.program.parseAsync(['maintenance','scan','--wait'],{from:'user'});
  expect(scan.request).toHaveBeenCalledWith('maintenance/scan',{});
  expect(scan.wait).toHaveBeenCalledWith({ok:true},true);
});
