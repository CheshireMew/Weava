import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readOwnerPassword } from '../owner-input.ts';
import { checkedLocalOwnerLink, localOwnerStatus } from '../owner-links.ts';
import { Site, withInstanceMaintenance } from '@weava/core';
import type { CliContext } from '../context.ts';

export function registerOwnerCommands({
  program,
  framework,
  bundledProgram,
  root,
  output,
  request,
  wait,
}: CliContext) {
  const owner = program.command('owner');

  owner
    .command('setup-link')
    .description('为尚未设置账户的站点生成一次性设置链接，10 分钟有效')
    .action(async () =>
      output(await checkedLocalOwnerLink(root(), 'initialize', program.opts().url)),
    );

  owner
    .command('reset-link')
    .description('从本机发放一次性账户重设链接；原账户在提交前保持不变')
    .option('--reset-two-factor', '明确允许同时清除丢失的两步验证；默认保留')
    .action(async (opts) =>
      output(
        await checkedLocalOwnerLink(root(), 'reset', program.opts().url, !!opts.resetTwoFactor),
      ),
    );

  owner
    .command('reset-password')
    .option('--password-file <file>', '不提供时在终端隐藏输入并确认密码')
    .option('--username <name>', '同时恢复账户名')
    .option('--rotate-cli-token', '同时撤销外部工具的旧令牌')
    .action(async (opts) => {
      const password = await readOwnerPassword(opts.passwordFile);
      return withInstanceMaintenance(root(), () => {
        const site = new Site(root());
        try {
          if (opts.username)
            output(
              site.auth.recoverAccount(opts.username, password, {
                rotateCliToken: opts.rotateCliToken,
              }),
            );
          else {
            site.setOwner(password);
            if (opts.rotateCliToken) site.auth.rotateCliToken(true);
            output({ updated: true, loginRequired: true, cliTokenRotated: !!opts.rotateCliToken });
          }
        } finally {
          site.close();
        }
      });
    });

  owner
    .command('recover')
    .description('停站后恢复站主账户，按选项处理两步验证和外部工具令牌')
    .requiredOption('--username <name>')
    .option('--password-file <file>')
    .option('--reset-two-factor', '同时关闭丢失的验证器')
    .option('--rotate-cli-token', '同时撤销外部工具旧令牌')
    .action(async (opts) => {
      const password = await readOwnerPassword(opts.passwordFile);
      return withInstanceMaintenance(root(), () => {
        const site = new Site(root());
        try {
          output(
            site.auth.recoverAccount(opts.username, password, {
              resetTwoFactor: opts.resetTwoFactor,
              rotateCliToken: opts.rotateCliToken,
            }),
          );
        } finally {
          site.close();
        }
      });
    });

  owner
    .command('status')
    .description('在本机查看站主账户名和后台入口，不输出秘密')
    .action(() => output(localOwnerStatus(root())));

  owner
    .command('admin-path')
    .description('停站后更改后台入口；旧地址返回 404')
    .requiredOption('--path <path>')
    .action((opts) =>
      withInstanceMaintenance(root(), () => {
        if (!existsSync(join(root(), 'weava.sqlite'))) throw new Error('站点未初始化。');
        const site = new Site(root());
        try {
          output(site.auth.setAdminPath(opts.path));
        } finally {
          site.close();
        }
      }),
    );

  owner
    .command('rotate-cli-token')
    .description('停站后轮换外部工具令牌，不输出令牌')
    .option('--revoke-sessions', '同时撤销全部网页登录')
    .action((opts) =>
      withInstanceMaintenance(root(), () => {
        if (!existsSync(join(root(), 'weava.sqlite'))) throw new Error('站点未初始化。');
        const site = new Site(root());
        try {
          output(site.auth.rotateCliToken(!!opts.revokeSessions));
        } finally {
          site.close();
        }
      }),
    );

  owner
    .command('reset-two-factor')
    .description('停站后清除站主两步验证并撤销全部登录会话')
    .requiredOption('--confirm', '确认已持有站点本机控制权，需要恢复两步验证')
    .action(() =>
      withInstanceMaintenance(root(), () => {
        if (!existsSync(join(root(), 'weava.sqlite'))) throw new Error('站点未初始化。');
        const site = new Site(root());
        try {
          site.auth.resetTwoFactor();
          output({ updated: true, loginRequired: true });
        } finally {
          site.close();
        }
      }),
    );
}
