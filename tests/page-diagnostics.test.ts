import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeDiagnosticRecords, diagnosticReportHtml, TraceEventReader, TraceEvidenceCollector, writeDiagnosticReport } from '../packages/cli/src/diagnostics/report.ts';
import { NativeTraceRecorder } from '../packages/cli/src/diagnostics/tracing.ts';
import type { DiagnosticCdp } from '../packages/cli/src/diagnostics/cdp.ts';

describe('page diagnostic evidence', () => {
  it('reads arbitrary CDP chunk boundaries without confusing quoted braces or unicode with trace structure', () => {
    const events = [
      { name: 'thread_name', ph: 'M', ts: 0, pid: 1, tid: 2, args: { name: 'CrBrowserMain' } },
      { name: 'MessagePumpForUI DispatchMessage', ph: 'X', ts: 9000, dur: 1200000, pid: 1, tid: 2, args: { text: '中文 } ] { \\" test' } },
    ];
    const source = JSON.stringify({ traceEvents: events, metadata: { note: 'ignored' } });
    const found: unknown[] = [], reader = new TraceEventReader((event) => found.push(event));
    for (const char of source) reader.push(char);
    reader.finish(); expect(found).toEqual(events); expect(reader.count).toBe(2);
  });

  it('aligns native windows-message stalls with the marker while excluding the earlier initial page layout', () => {
    const collector = new TraceEvidenceCollector();
    collector.consume({ name: 'weava:diagnostic-clock:doc', ph: 'R', ts: 1000000, pid: 1, tid: 3 });
    collector.consume({ name: 'MessagePumpForUI DispatchMessage', ph: 'X', ts: 21000000, dur: 1700000, tdur: 1600000, pid: 1, tid: 2, args: { chrome_message_pump_for_ui: { message_id: 1024 } } });
    // Thread metadata may arrive after the event it describes.
    collector.consume({ name: 'thread_name', ph: 'M', ts: 0, pid: 1, tid: 2, args: { name: 'CrBrowserMain' } });
    const document = { kind: 'document', at: 100000, clockName: 'weava:diagnostic-clock:doc', timeOrigin: 100000, clockMs: 0 };
    const records = [document, { kind: 'longtask', at: 101000, start: 100100, duration: 850 }, { kind: 'loaded', at: 102000 },
      { kind: 'marker', at: 122000, label: '滚动卡住' }];
    const report = analyzeDiagnosticRecords(records, collector.finish([document]), { startedAt: 100000, endedAt: 123000, phase: 'complete' });
    expect(report.markers[0].conclusion).toContain('浏览器窗口线程阻塞');
    expect(report.markers[0].afterLoad).toBe(true);
    expect(report.markers[0].evidence).toEqual([expect.objectContaining({ kind: 'browser-ui', maxMs: 1700 })]);
    expect(report.native.evidence[0]).toMatchObject({ at: 120000, messageId: 1024, cpuMs: 1600 });
  });

  it('keeps an unresolved stall unresolved when only a long document and concurrent requests are known', () => {
    const records = [{ kind: 'document', at: 1000 }, { kind: 'snapshot', at: 1200, elements: 12000 },
      { kind: 'request', at: 8000, id: 'image', url: 'http://localhost/image.jpg' },
      { kind: 'marker', at: 9000, label: '卡顿' }];
    const report = analyzeDiagnosticRecords(records, { evidence: [], synchronized: false }, { startedAt: 1000, endedAt: 10000, phase: 'complete' });
    expect(report.markers[0].conclusion).toContain('未定位');
    expect(report.markers[0].evidence[0].detail).toContain('不等于');
    expect(report.warnings).toContainEqual(expect.stringContaining('无法排除浏览器窗口'));
  });

  it('does not report returning from a hidden tab as a foreground frame freeze or an arrived response as waiting for headers', () => {
    const report = analyzeDiagnosticRecords([
      { kind: 'visibility', at: 2000, value: 'hidden' }, { kind: 'frame', at: 6000, gap: 4100, visibility: 'visible' },
      { kind: 'request', at: 1000, id: 'pulse', url: '/analytics' }, { kind: 'response', at: 1300, id: 'pulse', status: 200 },
      { kind: 'marker', at: 6500 },
    ], { evidence: [], synchronized: true }, { startedAt: 1000, endedAt: 4000, phase: 'complete' });
    expect(report.summary.frameGaps).toBe(0);
    expect(report.network[0]).toMatchObject({ phase: 'response-received', ttfbMs: 300, duration: 300 });
    expect(report.session.endedAt).toBe(6500);
  });

  it('coalesces repeated checkpoint requests instead of queuing a long tail of native trace work', async () => {
    const directory = join('D:/Tools/cache/weava/tests/page-diagnostics', Date.now() + '-rotation'); mkdirSync(directory, { recursive: true });
    const listeners = new Set<(value: any) => void>(); let endings = 0;
    const fake = {
      on: (listener: (value: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      send: async (method: string) => {
        if (method === 'Tracing.end') { endings++; queueMicrotask(() => { for (const listener of listeners) listener({ method: 'Tracing.tracingComplete', params: { stream: 'stream' } }); }); }
        if (method === 'IO.read') { await new Promise((resolve) => setTimeout(resolve, 5)); return { data: '{"traceEvents":[]}', eof: true }; }
        return {};
      },
    } as unknown as DiagnosticCdp;
    const recorder = new NativeTraceRecorder(fake, directory, () => {}); await recorder.start();
    for (let index = 0; index < 20; index++) recorder.checkpoint();
    await recorder.finish();
    expect(endings).toBe(2); expect(recorder.files).toHaveLength(2); expect(recorder.errors).toEqual([]);
  });

  it('recovers valid records and completed native segments after an interrupted recording', async () => {
    const directory = join('D:/Tools/cache/weava/tests/page-diagnostics', Date.now() + '-' + Math.random().toString(36).slice(2));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'session.json'), JSON.stringify({ startedAt: 1000, phase: 'recording', traceFiles: ['trace-0001.json', 'trace-0002.json'] }));
    writeFileSync(join(directory, 'events.ndjson'), JSON.stringify({ kind: 'marker', at: 9000, label: '</script><script>bad()</script>' }) + '\n{"incomplete":');
    writeFileSync(join(directory, 'trace-0001.json'), JSON.stringify({ traceEvents: [] }));
    writeFileSync(join(directory, 'trace-0002.json'), '{"traceEvents":[{"unfinished":');
    const report = await writeDiagnosticReport(directory);
    expect(report.markers).toHaveLength(1);
    expect(report.warnings.join('\n')).toContain('不完整');
    expect(report.warnings.join('\n')).toContain('录制未正常结束');
    const html = readFileSync(join(directory, 'report.html'), 'utf8');
    expect(html).not.toContain('</script><script>bad()');
    expect(html).toContain('\\u003c/script>');
    expect(diagnosticReportHtml(report)).toContain('同一时间线');
  });
});
