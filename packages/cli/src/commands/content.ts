import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

import { open as openFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {createHash} from 'node:crypto';
import {mediaUploadLimit} from '@weava/contracts';
import type { CliContext } from '../context.ts';

export function registerContentCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  program
    .command('schema')
    .option('--format <format>', 'json、openapi 或 types', 'json')
    .option('--output <path>')
    .action(async (opts) => {
      if (!['json', 'openapi', 'types'].includes(opts.format))
        throw new Error('格式需要是 json、openapi 或 types。');
      const result = await request(
        'schema?format=' + opts.format,
        undefined,
        opts.format === 'types' ? 'text' : 'json',
      );
      if (opts.output) {
        writeFileSync(
          resolve(opts.output),
          typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        );
        output({ path: resolve(opts.output) });
      } else if (typeof result === 'string') console.log(result);
      else output(result);
    });

  program
    .command('media-upload <file>')
    .description('分块上传媒体；用 --upload-id 继续上次上传')
    .option('--upload-id <id>')
    .option('--wait')
    .action(async (file, options) => {
      const path = resolve(file),
        handle = await openFile(path, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error('请选择普通文件。');
        const maximum=mediaUploadLimit(basename(path),await request('media/limits'));
        if(info.size<1||info.size>maximum)throw new Error('附件大小需要在 '+maximum/1048576+' MB 以内。');
        const hash=createHash('sha256'),part=Buffer.allocUnsafe(1024*1024);
        for(let offset=0;offset<info.size;){const {bytesRead}=await handle.read(part,0,Math.min(part.length,info.size-offset),offset);if(!bytesRead)throw new Error('文件在校验期间发生变化。');hash.update(part.subarray(0,bytesRead));offset+=bytesRead;}
        const sha256=hash.digest('hex');
        let state = options.uploadId
          ? await request('media/uploads/' + encodeURIComponent(options.uploadId))
          : await request('media/uploads', { name: basename(path), size: info.size,sha256 });
        if (state.size !== info.size || state.name !== basename(path)||state.sha256!==sha256)
          throw new Error('上传状态对应的文件内容、名称或大小不同，请重新开始上传。');
        output({ uploadId: state.id, offset: state.offset, size: state.size });
        const buffer = Buffer.allocUnsafe(state.chunkBytes);
        while (state.offset < state.size) {
          const offset = state.offset,
            { bytesRead } = await handle.read(
              buffer,
              0,
              Math.min(buffer.length, state.size - offset),
              offset,
            );
          if (!bytesRead) throw new Error('文件在上传期间发生变化。');
          try {
            state = await request(
              'media/uploads/' + encodeURIComponent(state.id) + '?offset=' + offset,
              buffer.subarray(0, bytesRead),
            );
          } catch (error) {
            const latest = await request('media/uploads/' + encodeURIComponent(state.id)).catch(
              () => null,
            );
            if (latest?.offset > offset) {
              state = latest;
              continue;
            }
            throw error;
          }
        }
        output(await wait(await request('media', { uploadId: state.id }), !!options.wait));
      } finally {
        await handle.close();
      }
    });
  program.command('media-upload-cancel').requiredOption('--id <id>').action(async options=>output(await request('media/uploads/cancel',{id:options.id})));

  for (const name of ['content', 'page', 'settings', 'media']) {
    const command = program.command(name);
    if(name==='content'||name==='page'){
      const trash=command.command('trash');
      trash.command('list').option('--page <page>','页码','1').option('--query <text>').action(async options=>output(await request('entries/trash?'+new URLSearchParams({page:options.page,kind:name==='page'?'page':'content',...(options.query?{q:options.query}:{})}))));
      trash.command('restore').requiredOption('--id <id>').requiredOption('--revision <revision>').action(async options=>output(await request('entries/trash/restore',{id:options.id,revision:Number(options.revision)})));
      trash.command('purge').requiredOption('--id <id>').requiredOption('--revision <revision>').requiredOption('--confirm <text>','必须明确填写“永久删除”').action(async options=>output(await request('entries/trash/purge',{id:options.id,revision:Number(options.revision),confirmation:options.confirm})));
    }
    if (name === 'media') {
      const replacement=command.command('replace');
      replacement.requiredOption('--from <id>').requiredOption('--to <id>').option('--ids <ids>','逗号分隔的内容编号').option('--review <review>','提交预检返回的 review；未提供时只预检').action(async options=>output(await request(options.review?'media/replace/apply':'media/replace/preview',{fromId:options.from,toId:options.to,...(options.ids?{ids:options.ids.split(',')}:{}),...(options.review?{review:options.review}:{})})));
      const groups = command.command('group');
      const presets = command.command('preset');
      presets.command('list').action(async () => output(await request('media/presets')));
      presets
        .command('save')
        .requiredOption('--input <file>')
        .action(async (opts) =>
          output(
            await request(
              'media/presets',
              JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
            ),
          ),
        );
      command
        .command('variant')
        .requiredOption('--input <file>')
        .option('--wait')
        .action(async (opts) =>
          output(
            await wait(
              await request(
                'media/variant',
                JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
              ),
              !!opts.wait,
            ),
          ),
        );

      groups.command('list').action(async () => output(await request('media/groups')));
      groups
        .command('save')
        .requiredOption('--input <file>')
        .action(async (opts) =>
          output(
            await request(
              'media/groups',
              JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
            ),
          ),
        );
      command
        .command('move')
        .requiredOption('--input <file>')
        .action(async (opts) =>
          output(
            await request(
              'media/move',
              JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
            ),
          ),
        );
    }
    if (name === 'content' || name === 'page')
      command
        .command('check')
        .requiredOption('--input <file>')
        .option('--draft', '只检查草稿有效值，允许暂时缺少必填项')
        .action(async (opts) => {
          const source = JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, ''));
          const result = await request('entry/check', {
            value: source.value ?? source,
            required: !opts.draft,
          });
          output(result);
          if (!result.valid) process.exitCode = 1;
        });
    if (name === 'content' || name === 'page')
      command
        .command('new')
        .option('--type <id>')
        .option('--template <id>')
        .option('--title <title>')
        .option('--path <path>')
        .action(async (opts) =>
          output(
            await request('entries/create', {
              kind: name === 'page' ? 'page' : 'content',
              type: opts.type,
              templateId: opts.template,
              title: opts.title,
              path: opts.path,
            }),
          ),
        );
    if (name === 'content' || name === 'page')
      command
        .command('bulk')
        .requiredOption('--input <file>')
        .option('--apply', '提交带 review 的已检查修改')
        .action(async (opts) =>
          output(
            await request(
              opts.apply ? 'entries/bulk/apply' : 'entries/bulk/preview',
              JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
            ),
          ),
        );
    if (['content', 'page'].includes(name))
      command
        .command('get')
        .requiredOption('--id <id>')
        .action(async (opts) => output(await request('entry/' + encodeURIComponent(opts.id))));
    command
      .command('list')
      .option('--page <page>', '页码', '1')
      .option('--page-size <count>', '每页数量', '25')
      .option('--type <type>', '内容类型')
      .option('--category <category>', '分类编号或名称')
      .option('--tag <tag>', '标签编号或名称')
      .option('--query <text>', '标题、摘要和正文')
      .option('--status <status>', '内容状态')
      .option('--visibility <visibility>', '可见性')
      .option('--field <key=value...>', '声明为可筛选的字段条件')
      .action(async (opts) =>
        output(
          await request(
            name === 'settings'
              ? 'settings'
              : name === 'media'
                ? 'media'
                : 'entries/query?' +
                  new URLSearchParams({
                    kind: name === 'page' ? 'page' : 'content',
                    page: opts.page,
                    pageSize: opts.pageSize,
                    ...(opts.type ? { type: opts.type } : {}),
                    ...(opts.category ? { category: opts.category } : {}),
                    ...(opts.tag ? { tag: opts.tag } : {}),
                    ...(opts.query ? { q: opts.query } : {}),
                    ...(opts.status ? { status: opts.status } : {}),
                    ...(opts.visibility ? { visibility: opts.visibility } : {}),
                    ...Object.fromEntries(
                      (opts.field ?? []).map((value: string) => {
                        const split = value.indexOf('=');
                        if (split < 1) throw new Error('字段条件需要 key=value。');
                        return ['field.' + value.slice(0, split), value.slice(split + 1)];
                      }),
                    ),
                  }),
          ),
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

  for (const [name, endpoint] of [
    ['view', 'authoring/views'],
    ['creation-template', 'authoring/templates'],
  ] as const) {
    const command = program.command(name);
    command.command('list').action(async () => output(await request(endpoint)));
    command
      .command('save')
      .requiredOption('--input <file>')
      .action(async (opts) =>
        output(
          await request(
            endpoint,
            JSON.parse(readFileSync(opts.input, 'utf8').replace(/^\ufeff/, '')),
          ),
        ),
      );
  }

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
    .option('--merge', '合并已有对象，需要输入文件提供 revisions')
    .option('--dry-run', '完整校验并报告，不保存')
    .option('--wait', '等待后台导入或预检完成')
    .action(async (opts) => {
      const data = JSON.parse(readFileSync(resolve(opts.input), 'utf8').replace(/^\ufeff/, ''));
      output(
        await wait(await request('import', {
          value: data,
          options: {
            mode: opts.merge ? 'merge' : 'create',
            dryRun: !!opts.dryRun,
            revisions: data.revisions,
          },
        }),!!opts.wait),
      );
    });
}
