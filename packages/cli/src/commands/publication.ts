import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import type { CliContext } from '../context.ts';

export function registerPublicationCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  const redirects = program.command('redirect');

  const plans = program.command('publication-plan');

  plans.command('list').action(async () => output(await request('plans')));

  plans
    .command('save')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await request('plans', JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, ''))),
      ),
    );

  plans
    .command('preview')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>')
    .action(async (opts) =>
      output(await request('plans/preview', { id: opts.id, revision: Number(opts.revision) })),
    );

  plans
    .command('run')
    .requiredOption('--input <file>', 'plans preview 的完整结果')
    .option('--wait')
    .action(async (opts) => {
      const checked = JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, ''));
      output(
        await wait(
          await request('plans/run', {
            id: checked.plan.id,
            revision: checked.plan.revision,
            options: checked.review.options,
          }),
          !!opts.wait,
        ),
      );
    });

  plans
    .command('cancel')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>')
    .action(async (opts) =>
      output(await request('plans/cancel', { id: opts.id, revision: Number(opts.revision) })),
    );

  redirects.command('list').action(async () => output(await request('redirects')));

  redirects
    .command('preview')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await request(
          'redirects/preview',
          JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
        ),
      ),
    );

  redirects
    .command('save')
    .requiredOption('--input <file>')
    .action(async (opts) =>
      output(
        await request(
          'redirects/save',
          JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
        ),
      ),
    );

  program
    .command('publish')
    .option('--id <id...>')
    .option('--input <file>', '使用 publication preview 返回的原始检查结果')
    .option('--wait')
    .action(async (opts) =>
      output(
        await wait(
          await request(
            'publish',
            (() => {
              if (opts.input && opts.id) throw new Error('--input 与 --id 不能同时使用。');
              if (!opts.input) return { ids: opts.id };
              const review = JSON.parse(
                readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, ''),
              );
              if (
                !review.options ||
                !Object.hasOwn(review.options, 'baseReleaseId') ||
                !Number.isInteger(review.options.reviewRevision)
              )
                throw new Error('需要完整的发布预检结果。');
              return review.options;
            })(),
          ),
          !!opts.wait,
        ),
      ),
    );

  const publication = program.command('publication');

  publication
    .command('preview')
    .option('--id <id...>')
    .option('--scope <scope>')
    .option('--output <file>')
    .action(async (opts) => {
      const review = await request('publication', {
        ...(opts.id ? { ids: opts.id } : {}),
        ...(opts.scope ? { scope: opts.scope } : {}),
      });
      if (opts.output) writeFileSync(resolve(opts.output), JSON.stringify(review, null, 2));
      output(review);
    });

  program
    .command('rollback')
    .requiredOption('--id <id>')
    .action(async (opts) => output(await request('rollback', { id: opts.id })));

  const schedule = program.command('schedule');

  schedule.command('list').action(async () => output(await request('schedules')));

  schedule
    .command('create')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>')
    .requiredOption('--at <time>', '带时区的发布时间')
    .action(async (opts) =>
      output(
        await request('schedule', { id: opts.id, revision: Number(opts.revision), dueAt: opts.at }),
      ),
    );

  for (const action of ['cancel', 'retry'])
    schedule
      .command(action)
      .requiredOption('--id <id>')
      .requiredOption('--revision <revision>')
      .action(async (opts) =>
        output(
          await request('schedule/' + action, { id: opts.id, revision: Number(opts.revision) }),
        ),
      );
}
