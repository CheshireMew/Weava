import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { rollbackReview } from '../../../contracts/src/api-models.ts';
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
    .option('--wait')
    .action(async (opts) =>
      output(
        await wait(await request('plans', JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, ''))),!!opts.wait),
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
    .description('查看或恢复历史公开版本')
    .option('--id <id>', '查看恢复此版本会产生的变更')
    .option('--output <file>', '保存恢复预览 JSON')
    .option('--input <file>', '按原样提交恢复预览 JSON')
    .action(async (opts) => {
      if (opts.input) {
        if (opts.id || opts.output) throw new Error('--input 不能与 --id 或 --output 同时使用。');
        const checked=rollbackReview.safeParse(JSON.parse(readFileSync(resolve(opts.input),'utf8').replace(/^\ufeff/,'')));
        if(!checked.success)throw new Error('需要 rollback --id 返回的完整恢复预览。');
        const {id,baseReleaseId,review}=checked.data;
        output(await request('rollback',{id,baseReleaseId,review}));
        return;
      }
      if (!opts.id) throw new Error('使用 --id 查看恢复预览，或使用 --input 提交预览结果。');
      const checked=await request('rollback/preview',{id:opts.id});
      if(opts.output)writeFileSync(resolve(opts.output),JSON.stringify(checked,null,2));
      output(checked);
    });

  const schedule = program.command('schedule');

  schedule.command('list').action(async () => output(await request('schedules')));

  schedule
    .command('create')
    .requiredOption('--id <id>')
    .requiredOption('--revision <revision>')
    .requiredOption('--at <time>', '带时区的发布时间')
    .option('--wait')
    .action(async (opts) =>
      output(
        await wait(await request('schedule', { id: opts.id, revision: Number(opts.revision), dueAt: opts.at }),!!opts.wait),
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
