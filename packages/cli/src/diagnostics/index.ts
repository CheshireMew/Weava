import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { capturePageDiagnostics, diagnosticControl } from './capture.ts';
import { writeDiagnosticReport } from './report.ts';

export function registerDiagnostics(program: Command, output: (value: unknown) => void) {
  const diagnose = program.command('diagnose').description('记录页面、真实输入与浏览器原生性能轨迹，按卡顿标记生成报告');
  diagnose.command('page').option('--url <url>', '需要排查的页面地址')
    .option('--output <directory>', '新诊断目录，默认保存在 D:/Tools/cache/weava/diagnostics')
    .option('--browser <name>', '使用已安装的 edge 或 chrome', 'edge')
    .option('--executable <path>', '指定已安装浏览器程序')
    .option('--duration <seconds>', '最长录制时间，3 至 600 秒', '120')
    .option('--headless', '无界面采集，无法验证真实鼠标和屏幕呈现')
    .action(async (options) => {
      const url = options.url ?? program.opts().url;
      if (!url) throw new Error('请使用 --url 指定需要排查的页面地址。');
      if (!['edge', 'chrome'].includes(options.browser)) throw new Error('--browser 需要为 edge 或 chrome。');
      const result = await capturePageDiagnostics({ ...options, url, duration: Number(options.duration), onReady: (state) => output({
        event: 'diagnostic-started', phase: state.phase, directory: state.directory, url: state.url,
        controls: { mark: 'weava diagnose mark --session "' + state.directory + '"', stop: 'weava diagnose stop --session "' + state.directory + '"' },
      }) });
      output({ event: 'diagnostic-complete', ...result });
    });
  diagnose.command('status').requiredOption('--session <directory>').action((options) => {
    output(JSON.parse(readFileSync(join(resolve(options.session), 'session.json'), 'utf8')));
  });
  diagnose.command('mark').requiredOption('--session <directory>').option('--label <text>', '这次卡顿的描述', '手动标记卡顿')
    .action((options) => output(diagnosticControl(options.session, 'marker', options.label)));
  diagnose.command('stop').requiredOption('--session <directory>')
    .action((options) => output(diagnosticControl(options.session, 'stop')));
  diagnose.command('report').requiredOption('--session <directory>', '录制完成或中断后重新分析已有记录')
    .action(async (options) => {
      const directory = resolve(options.session), report = await writeDiagnosticReport(directory);
      output({ directory, report: join(directory, 'report.html'), json: join(directory, 'report.json'), summary: report.summary, warnings: report.warnings });
    });
}
