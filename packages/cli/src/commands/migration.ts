import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Site,
  withInstanceMaintenance,
  writeWordpressStatisticsExportScript,
  extractWordpressStatistics,
  readWordpressStatistics,
  inspectWordpressStatistics,
  planWordpressStatistics,
  importWordpressStatistics,
} from '@weava/core';
import { migrateCrypto } from '../../../crypto-migration/src/migrate.ts';
import { convertCryptoSite } from '../../../crypto-migration/src/convert.ts';
import { migrateWordPress, migrateWordPressViews } from '../../../core/src/migrate-wordpress.ts';
import { migrateWordPressRoutes } from '../../../core/src/migrate-wordpress-routes.ts';
import { importWordPressWxr } from '../../../core/src/wordpress-wxr.ts';
import type { CliContext } from '../context.ts';

export function registerMigrationCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  const markdown=program.command('markdown');
  markdown.command('export').requiredOption('--output <folder>').option('--budget-mib <size>','本次输出体积上限；大于 1 GiB 须明确提高','1024').option('--wait').action(async options=>output(await wait(await request('export/markdown',{path:resolve(options.output),budgetBytes:Number(options.budgetMib)*1048576}),!!options.wait)));
  for(const action of ['preview','import'])markdown.command(action).requiredOption('--input <folder>').option('--type <type>').option('--merge').option('--settings').option('--review <review>','导入时必须使用预检返回的凭据').option('--budget-mib <size>','本次处理体积上限','1024').option('--wait').action(async options=>{if(action==='import'&&!options.review)throw new Error('请先 preview，再提供 --review。');output(await wait(await request(action==='preview'?'import/markdown/preview':'import/markdown',{path:resolve(options.input),options:{...(options.type?{type:options.type}:{}),merge:!!options.merge,settings:!!options.settings,budgetBytes:Number(options.budgetMib)*1048576,...(options.review?{review:options.review}:{})}}),!!options.wait));});
  const migrate = program.command('migrate');
  migrate.command('library')
    .option('--dry-run', '检查加密旧站转换，不保存')
    .action(async opts => output(await withInstanceMaintenance(root(), () =>
      convertCryptoSite(root(),root(),{apply:true,dryRun:!!opts.dryRun}))));

  migrate
    .command('wxr')
    .requiredOption('--input <file>', 'WordPress 标准 WXR XML 导出文件')
    .option('--dry-run', '完整预检，不保存')
    .option('--settings', '同时导入网站名称、说明和语言')
    .option('--download-media', '下载 WXR 附件')
    .option('--media-dir <path>', '离线附件目录，按来源 URL 路径存放')
    .option('--no-comments', '不导入来源评论')
    .option('--merge-revisions <file>', '合并已有内容的当前修订号，格式与 JSON 导入相同')
    .action(async (opts) => {
      return withInstanceMaintenance(root(), async () => {
        const site = new Site(root());
        try {
          output(
            await importWordPressWxr(
              site,
              { file: resolve(opts.input) },
              {
                dryRun: !!opts.dryRun,
                settings: !!opts.settings,
                downloadMedia: !!opts.downloadMedia,
                mediaDirectory: opts.mediaDir ? resolve(opts.mediaDir) : undefined,
                comments: opts.comments,
                ...(opts.mergeRevisions
                  ? {
                      mode: 'merge',
                      revisions: JSON.parse(readFileSync(resolve(opts.mergeRevisions), 'utf8')),
                    }
                  : {}),
              },
            ),
          );
        } finally {
          site.close();
        }
      });
    });

  migrate
    .command('crypto')
    .requiredOption('--source <path>')
    .requiredOption('--capture <path>')
    .option('--dry-run')
    .action(async (opts) => {
      await withInstanceMaintenance(root(), async () =>
        output(
          await migrateCrypto(resolve(opts.source), root(), resolve(opts.capture), !!opts.dryRun),
        ),
      );
    });

  migrate
    .command('wordpress')
    .requiredOption('--source <path>', '已下载的 WordPress 内容目录')
    .option('--dry-run')
    .action(async (opts) => {
      await withInstanceMaintenance(root(), async () =>
        output(await migrateWordPress(resolve(opts.source), root(), !!opts.dryRun)),
      );
    });

  migrate
    .command('wordpress-routes')
    .requiredOption('--input <file>', 'wordpress-routes-v1 公开网址与内容快照')
    .option('--dry-run')
    .action(async (opts) =>
      output(await migrateWordPressRoutes(resolve(opts.input), root(), !!opts.dryRun)),
    );

  migrate
    .command('wordpress-views')
    .requiredOption('--input <file>', 'WordPress 文章累计浏览量快照')
    .action(async (opts) => {
      await withInstanceMaintenance(root(), async () =>
        output(await migrateWordPressViews(resolve(opts.input), root())),
      );
    });

  migrate
    .command('wordpress-statistics-script')
    .requiredOption('--wordpress-root <path>', '来源服务器上的 WordPress 绝对目录')
    .requiredOption('--output <file>', '创建只读导出脚本，拒绝覆盖已有文件')
    .option('--php', '输出独立 PHP 文件，默认输出可供 SSH 执行的 shell 脚本')
    .action((opts) =>
      output(
        writeWordpressStatisticsExportScript(
          opts.wordpressRoot,
          opts.output,
          opts.php ? 'php' : 'shell',
        ),
      ),
    );

  migrate
    .command('wordpress-statistics-extract')
    .requiredOption('--input <file>', 'server-ops JSON 响应或原始导出快照')
    .requiredOption('--output <file>', '创建校验后的独立快照文件')
    .action((opts) =>
      output(extractWordpressStatistics(resolve(opts.input), resolve(opts.output))),
    );

  migrate
    .command('wordpress-statistics-inspect')
    .requiredOption('--input <file>', '独立快照或 server-ops JSON 响应')
    .action((opts) =>
      output(inspectWordpressStatistics(readWordpressStatistics(resolve(opts.input)))),
    );

  migrate
    .command('wordpress-statistics')
    .requiredOption('--input <file>', 'WP Statistics 完整只读快照')
    .option('--dry-run', '只预检，默认行为，不修改站点')
    .option('--plan-output <file>', '保存预检方案，拒绝覆盖已有文件')
    .option('--apply', '按预检方案导入；目标必须离线')
    .option('--review <file>', '此前保存的预检方案 JSON')
    .action(async (opts) => {
      if (opts.apply && opts.dryRun) throw new Error('--apply 与 --dry-run 不能同时使用。');
      if (opts.apply) {
        if (!opts.review) throw new Error('请先预检并使用 --review 提供方案。');
        const review = JSON.parse(
          readFileSync(resolve(opts.review), 'utf8').replace(/^\ufeff/, ''),
        );
        output(await importWordpressStatistics(resolve(opts.input), root(), review.review));
      } else {
        const plan = planWordpressStatistics(resolve(opts.input), root());
        if (opts.planOutput)
          writeFileSync(resolve(opts.planOutput), JSON.stringify(plan, null, 2), { flag: 'wx' });
        output(plan);
      }
    });
}
