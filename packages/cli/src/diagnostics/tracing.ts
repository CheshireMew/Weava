import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { DiagnosticCdp } from './cdp.ts';

/** Rotate native traces so both earlier stalls and a bounded browser buffer survive long recordings. */
export class NativeTraceRecorder {
  readonly files: string[] = [];
  readonly segments: { file: string; startedAt: number; endedAt: number }[] = [];
  readonly errors: string[] = [];
  private active = false;
  private startedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ending = false;
  private rotating = false;
  constructor(private cdp: DiagnosticCdp, private directory: string, private changed: () => void) {}
  private async begin() {
    await this.cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: {
      recordMode: 'recordContinuously', traceBufferSizeInKb: 131072,
      includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'input', 'latencyInfo', 'toplevel', 'cc', 'benchmark', 'gpu', 'viz'],
    } });
    this.startedAt = Date.now(); this.active = true;
  }
  async start() {
    await this.begin();
    this.timer = setInterval(() => this.checkpoint(), 20000);
  }
  checkpoint() {
    if (this.ending || this.rotating) return;
    this.rotating = true;
    this.queue = this.queue.then(() => this.rotate(false)).catch((error) => { this.errors.push((error as Error).message); })
      .finally(() => { this.rotating = false; });
  }
  private async rotate(final: boolean) {
    if (!this.active) return;
    const startedAt = this.startedAt;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>;
    const completed = new Promise<any>((resolve, reject) => {
      timer = setTimeout(() => { unsubscribe(); reject(new Error('等待原生轨迹结束超时。')); }, 30000);
      unsubscribe = this.cdp.on((event) => { if (event.method === 'Tracing.tracingComplete') { clearTimeout(timer); unsubscribe(); resolve(event.params); } });
    });
    // Attach a rejection handler before sending a command which may itself fail.
    completed.catch(() => {});
    let result: any;
    try { await this.cdp.send('Tracing.end'); result = await completed; }
    finally { clearTimeout(timer!); unsubscribe(); this.active = false; }
    const endedAt = Date.now();
    if (result.dataLossOccurred) this.errors.push('浏览器报告原生轨迹有记录丢失；不能据此排除未记录的阻塞。');
    if (!final) await this.begin();
    const file = 'trace-' + String(this.files.length + 1).padStart(4, '0') + '.json';
    // Register before writing: an interrupted stream remains discoverable by diagnose report.
    this.files.push(file); this.segments.push({ file, startedAt, endedAt }); this.changed();
    const output = createWriteStream(join(this.directory, file), { flags: 'wx' });
    const closed = once(output, 'finish'); closed.catch(() => {});
    try {
      while (true) {
        const chunk = await this.cdp.send('IO.read', { handle: result.stream, size: 256 * 1024 });
        const bytes = chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data;
        if (!output.write(bytes)) await once(output, 'drain');
        if (chunk.eof) break;
      }
      output.end(); await closed;
    } catch (error) { output.destroy(); throw error; }
    finally { await this.cdp.send('IO.close', { handle: result.stream }).catch(() => {}); }
  }
  async finish() {
    this.ending = true; clearInterval(this.timer);
    await this.queue;
    try { await this.rotate(true); } catch (error) { this.errors.push((error as Error).message); }
  }
}
