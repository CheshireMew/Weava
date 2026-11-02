import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagnosticCdp } from './cdp.ts';
import { installDiagnosticProbe } from './probe.ts';
import { NativeTraceRecorder } from './tracing.ts';
import { writeDiagnosticReport, type DiagnosticRecord } from './report.ts';

export interface CaptureOptions {
  url: string; output?: string; browser?: 'edge' | 'chrome'; executable?: string;
  duration?: number; headless?: boolean; onReady?: (state: any) => void;
}

function atomicState(path: string, value: unknown) {
  const pending = path + '.pending'; writeFileSync(pending, JSON.stringify(value, null, 2)); renameSync(pending, path);
}
function browserExecutable(options: CaptureOptions) {
  if (options.executable) { const path = resolve(options.executable); if (existsSync(path)) return path; throw new Error('浏览器不存在：' + path); }
  const browser = options.browser ?? 'edge';
  const candidates = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]
    .filter((root): root is string => !!root)
    .map((root) => join(root, browser === 'edge' ? 'Microsoft/Edge/Application/msedge.exe' : 'Google/Chrome/Application/chrome.exe'));
  const found = candidates.find(existsSync);
  if (!found) throw new Error('没有找到已安装的 ' + browser + '，可以通过 --executable 指定路径；诊断不会下载浏览器。');
  return found;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function capturePageDiagnostics(options: CaptureOptions) {
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('诊断地址需要使用 http 或 https。');
  const duration = options.duration ?? 120;
  if (!Number.isInteger(duration) || duration < 3 || duration > 600) throw new Error('录制时间需要是 3 至 600 秒的整数。');
  const executable = browserExecutable(options);
  const directory = resolve(options.output ?? join('D:/Tools/cache/weava/diagnostics', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)));
  if (existsSync(join(directory, 'session.json')) || existsSync(join(directory, 'events.ndjson'))) throw new Error('诊断目录已包含记录，请选择一个新目录。');
  mkdirSync(directory, { recursive: true });
  const profile = join(directory, 'browser-profile'), temporary = join(directory, 'browser-temp');
  mkdirSync(profile, { recursive: true }); mkdirSync(temporary, { recursive: true });
  const state: any = { version: 1, id: randomUUID(), phase: 'starting', pid: process.pid, url: url.href, directory,
    startedAt: Date.now(), browser: options.browser ?? 'edge', executable, headless: !!options.headless,
    durationSeconds: duration, traceFiles: [], counters: { wheel: 0, scroll: 0, marker: 0 }, traceErrors: [] };
  const statePath = join(directory, 'session.json'), eventsPath = join(directory, 'events.ndjson'), commandsPath = join(directory, 'commands.ndjson');
  writeFileSync(eventsPath, '', { flag: 'wx' }); writeFileSync(commandsPath, '', { flag: 'wx' });
  const save = () => atomicState(statePath, state);
  const record = (value: DiagnosticRecord) => appendFileSync(eventsPath, JSON.stringify(value) + '\n');
  save();
  let child: ChildProcess | undefined, cdp: DiagnosticCdp | undefined, native: NativeTraceRecorder | undefined;
  let targetSession = '', reason = '', stop = () => {}, poll: ReturnType<typeof setInterval> | undefined;
  let stopped = false, commandLineCount = 0;
  let resolveStopped: () => void;
  const stoppedPromise = new Promise<void>((resolve) => { resolveStopped = resolve; });
  stop = () => { if (!stopped) { stopped = true; resolveStopped(); } };
  const interrupt = () => { reason ||= 'interrupted'; stop(); };
  const stderr = createWriteStream(join(directory, 'browser.stderr.log'), { flags: 'a' });
  const stdout = createWriteStream(join(directory, 'browser.stdout.log'), { flags: 'a' });
  try {
    child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', ...(options.headless ? ['--headless=new'] : []), 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TEMP: temporary, TMP: temporary } });
    child.stdout?.pipe(stdout); child.stderr?.pipe(stderr);
    let launchError: Error | undefined;
    child.once('error', (error) => { launchError = error; });
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    while (!existsSync(portFile)) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('诊断浏览器未就绪，请检查 browser.stderr.log。');
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    cdp = await DiagnosticCdp.connect('ws://127.0.0.1:' + port + path);
    const version = await cdp.send('Browser.getVersion'); state.browserVersion = version.product; state.userAgent = version.userAgent;
    const targets = await cdp.send('Target.getTargets');
    const initialPage = targets.targetInfos.find((target: any) => target.type === 'page' && target.url === 'about:blank');
    const { targetId } = initialPage ?? await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1440, height: 1000 });
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true }); targetSession = attached.sessionId;
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const requestTimes = new Map<string, { mono: number; wall: number }>();
    const binding = '__weavaDiagnosticEvent';
    cdp.on((event) => {
      if (event.method === 'diagnostic.disconnected' || event.method === 'Target.targetDestroyed' && event.params.targetId === targetId) { reason ||= 'browser-closed'; stop(); return; }
      if (event.sessionId !== targetSession) return;
      const data = event.params ?? {};
      if (event.method === 'Runtime.bindingCalled' && data.name === binding) {
        try {
          const batch = JSON.parse(data.payload);
          if (batch.kind === 'finish') { reason ||= 'page'; stop(); }
          if (batch.kind === 'page-batch') {
            for (const item of batch.records) {
              if (state.endedAt && item.at > state.endedAt) continue;
              record({ ...item, documentId: batch.documentId });
              if (item.kind in state.counters) state.counters[item.kind]++;
              if (item.kind === 'marker') native?.checkpoint();
            }
            if (batch.dropped) record({ kind: 'dropped', at: Date.now(), count: batch.dropped });
          }
        } catch (error) { record({ kind: 'error', at: Date.now(), source: 'collector', message: (error as Error).message }); }
      }
      if (event.method === 'Network.requestWillBeSent') {
        requestTimes.set(data.requestId, { mono: data.timestamp, wall: data.wallTime * 1000 });
        record({ kind: 'request', at: data.wallTime * 1000, id: data.requestId, url: data.request.url, type: data.type, method: data.request.method });
      }
      if (event.method === 'Network.responseReceived' || event.method === 'Network.loadingFinished' || event.method === 'Network.loadingFailed') {
        const request = requestTimes.get(data.requestId);
        const at = request ? request.wall + (data.timestamp - request.mono) * 1000 : Date.now();
        if (event.method === 'Network.responseReceived') record({ kind: 'response', at, id: data.requestId, status: data.response.status, mime: data.response.mimeType, cached: data.response.fromDiskCache || data.response.fromServiceWorker });
        else { record({ kind: 'request-end', at, id: data.requestId, bytes: data.encodedDataLength, error: data.errorText }); requestTimes.delete(data.requestId); }
      }
      if (event.method === 'Runtime.exceptionThrown') record({ kind: 'error', at: Date.now(), source: 'page', message: data.exceptionDetails?.exception?.description ?? data.exceptionDetails?.text, url: data.exceptionDetails?.url });
      if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn'].includes(data.type)) record({ kind: 'console', at: data.timestamp, level: data.type, message: data.args.map((argument: any) => String(argument.value ?? argument.description ?? '')).join(' ').slice(0, 8000) });
    });
    for (const domain of ['Page', 'Runtime', 'Network', 'Performance']) await cdp.send(domain + '.enable', {}, targetSession);
    await cdp.send('Runtime.addBinding', { name: binding }, targetSession);
    // tsx preserves function names with an esbuild helper; supply its identity implementation in this isolated closure.
    const source = '(()=>{const __name=(value)=>value;(' + installDiagnosticProbe.toString() + ')(' + JSON.stringify({ binding, controls: !options.headless }) + ');})()';
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, targetSession);
    native = new NativeTraceRecorder(cdp, directory, () => { state.traceFiles = native!.files; save(); });
    await native.start();
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    await cdp.send('Page.navigate', { url: url.href }, targetSession);
    state.phase = 'recording'; state.recordingAt = Date.now(); save(); options.onReady?.(state);
    poll = setInterval(() => {
      try {
        const lines = readFileSync(commandsPath, 'utf8').split('\n');
        // Only consume complete lines; an interrupted append can be repaired without losing later commands.
        for (; commandLineCount < lines.length - 1; commandLineCount++) {
          if (!lines[commandLineCount].trim()) continue;
          try {
            const command = JSON.parse(lines[commandLineCount]);
            if (command.kind === 'marker') { record({ kind: 'marker', at: command.at, label: command.label ?? '外部标记卡顿', source: 'cli' }); state.counters.marker++; native?.checkpoint(); }
            if (command.kind === 'stop') { reason ||= 'cli'; stop(); }
          } catch (error) { record({ kind: 'error', at: Date.now(), source: 'control', message: (error as Error).message }); }
        }
        save();
        if (Date.now() - state.recordingAt >= duration * 1000) { reason ||= 'duration'; stop(); }
      } catch (error) { reason ||= (error as Error).message; stop(); }
    }, 500);
    await stoppedPromise;
    clearInterval(poll); state.phase = 'finishing'; state.stopReason = reason; save();
    await cdp.send('Runtime.evaluate', { expression: 'window.__weavaDiagnosticFinish?.()', returnByValue: true }, targetSession, 5000).catch(() => {});
    state.endedAt = Date.now(); save();
    await native.finish(); state.traceFiles = native.files; state.traceErrors = native.errors;
    writeFileSync(join(directory, 'trace-index.json'), JSON.stringify({ segments: native.segments, errors: native.errors }, null, 2));
    state.phase = 'complete'; save();
    const report = await writeDiagnosticReport(directory);
    return { phase: state.phase, directory, report: join(directory, 'report.html'), json: join(directory, 'report.json'), summary: report.summary, warnings: report.warnings };
  } catch (error) {
    state.phase = 'failed'; state.error = (error as Error).message; state.endedAt = Date.now(); save();
    if (native) { await native.finish().catch(() => {}); state.traceFiles = native.files; save(); }
    await writeDiagnosticReport(directory).catch(() => {});
    throw new Error(state.error + '；已保留诊断记录：' + directory);
  } finally {
    clearInterval(poll); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    if (cdp) { await cdp.send('Browser.close', {}, undefined, 3000).catch(() => {}); cdp.close(); }
    if (child && child.exitCode === null) {
      await Promise.race([new Promise((resolve) => child!.once('exit', resolve)), sleep(3000)]);
      if (child.exitCode === null) child.kill();
    }
    stdout.end(); stderr.end();
  }
}

export function diagnosticControl(directory: string, command: 'marker' | 'stop', label?: string) {
  const root = resolve(directory), state = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  if (state.phase !== 'recording') throw new Error('诊断当前不是录制状态：' + state.phase);
  try { process.kill(state.pid, 0); } catch { throw new Error('录制进程已退出，可使用 diagnose report 读取保留的记录。'); }
  appendFileSync(join(root, 'commands.ndjson'), JSON.stringify({ kind: command, at: Date.now(), label: label?.slice(0, 200) }) + '\n');
  return { requested: true, command, directory: root };
}
