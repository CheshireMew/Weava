import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type DiagnosticRecord = { kind: string; at: number; [key: string]: any };
type TraceEvent = { name: string; ph: string; ts: number; dur?: number; tdur?: number; pid: number; tid: number; args?: any };
export type TraceEvidence = { name: string; thread: string; duration: number; cpuMs?: number; at?: number; messageId?: number };

/** Reads Chrome's traceEvents array incrementally, including strings split across IO.read chunks. */
export class TraceEventReader {
  private prefix = '';
  private started = false;
  private ended = false;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private event = '';
  count = 0;
  constructor(private consume: (event: TraceEvent) => void) {}
  push(chunk: string) {
    if (this.ended) return;
    if (!this.started) {
      this.prefix += chunk;
      const match = /"traceEvents"\s*:\s*\[/.exec(this.prefix);
      if (!match) { if (this.prefix.length > 1024 * 1024) throw new Error('无法识别浏览器 traceEvents。'); return; }
      chunk = this.prefix.slice(match.index + match[0].length); this.prefix = ''; this.started = true;
    }
    let partStart = this.depth ? 0 : -1;
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index];
      if (!this.depth) {
        if (char === ']') { this.ended = true; return; }
        if (char !== '{') continue;
        this.depth = 1; this.quoted = false; this.escaped = false; partStart = index; continue;
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.quoted = false;
      } else if (char === '"') this.quoted = true;
      else if (char === '{' || char === '[') this.depth++;
      else if (char === '}' || char === ']') this.depth--;
      if (!this.depth) {
        this.event += chunk.slice(partStart, index + 1);
        this.consume(JSON.parse(this.event)); this.count++; this.event = ''; partStart = -1;
      }
    }
    if (this.depth && partStart >= 0) this.event += chunk.slice(partStart);
  }
  finish() { if (!this.started || !this.ended || this.depth) throw new Error('浏览器性能轨迹不完整；保留已有页面记录。'); }
}

export class TraceEvidenceCollector {
  private threads = new Map<string, string>();
  private clocks = new Map<string, number>();
  private candidates: TraceEvent[] = [];
  dropped = 0;
  consume(event: TraceEvent) {
    if (event.ph === 'M' && event.name === 'thread_name') this.threads.set(event.pid + ':' + event.tid, event.args?.name ?? '');
    if (event.name.startsWith('weava:diagnostic-clock:')) this.clocks.set(event.name, event.ts / 1000);
    if (event.ph !== 'X' || (event.dur ?? 0) < 50000) return;
    if (!['MessagePumpForUI DispatchMessage', 'RunTask', 'Layout', 'UpdateLayoutTree', 'Paint', 'RasterTask', 'GPUTask', 'LocalFrameView::RunAccessibilitySteps'].includes(event.name)) return;
    if (this.candidates.length < 20000) this.candidates.push(event); else this.dropped++;
  }
  finish(documents: DiagnosticRecord[]) {
    let offset: number | undefined;
    for (const document of documents) {
      const traceClock = this.clocks.get(document.clockName);
      if (traceClock !== undefined) { offset = document.timeOrigin + document.clockMs - traceClock; break; }
    }
    const evidence: TraceEvidence[] = this.candidates.flatMap((event) => {
      const thread = this.threads.get(event.pid + ':' + event.tid) ?? 'unknown';
      if (event.name === 'RunTask' && thread !== 'CrBrowserMain') return [];
      return [{ name: event.name, thread, duration: event.dur! / 1000,
        ...(event.tdur !== undefined ? { cpuMs: event.tdur / 1000 } : {}),
        ...(offset !== undefined ? { at: event.ts / 1000 + offset } : {}),
        ...(event.args?.chrome_message_pump_for_ui ? { messageId: event.args.chrome_message_pump_for_ui.message_id } : {}) }];
    });
    return { evidence, synchronized: offset !== undefined, dropped: this.dropped };
  }
}

const overlaps = (start: number, duration: number, from: number, to: number) => start < to && start + duration > from;
const maximum = (values: number[]) => Math.round(Math.max(0, ...values));

export function analyzeDiagnosticRecords(records: DiagnosticRecord[], trace: { evidence: TraceEvidence[]; synchronized: boolean; dropped?: number }, session: any) {
  const documents = records.filter((record) => record.kind === 'document');
  const snapshots = records.filter((record) => record.kind === 'snapshot');
  const tasks = records.filter((record) => record.kind === 'longtask');
  const hidden = records.filter((record) => record.kind === 'visibility' && record.value === 'hidden');
  const frames = records.filter((record) => record.kind === 'frame' && record.gap > 50 && record.visibility === 'visible' &&
    !hidden.some((event) => event.at >= record.at - record.gap && event.at <= record.at));
  const wheels = records.filter((record) => record.kind === 'wheel');
  const loaded = records.filter((record) => record.kind === 'loaded');
  const firstAt = session.startedAt ?? documents[0]?.at ?? records[0]?.at ?? Date.now();
  const endAt = records.reduce((end, record) => Math.max(end, record.at), session.endedAt ?? firstAt);
  // Prefer explicitly traced Windows messages. Browser RunTask is a fallback, never add their overlapping durations.
  const messages = trace.evidence.filter((event) => event.name === 'MessagePumpForUI DispatchMessage' && event.thread === 'CrBrowserMain');
  const browserBlocks = messages.length ? messages : trace.evidence.filter((event) => event.name === 'RunTask' && event.thread === 'CrBrowserMain');
  const requests = new Map<string, any>();
  for (const record of records) {
    if (record.kind === 'request') requests.set(record.id, { ...record });
    if (record.kind === 'response') { const item = requests.get(record.id); if (item) Object.assign(item, { status: record.status, responseAt: record.at, mime: record.mime, cached: record.cached }); }
    if (record.kind === 'request-end') { const item = requests.get(record.id); if (item) Object.assign(item, { endAt: record.at, bytes: record.bytes, error: record.error }); }
  }
  const network = [...requests.values()].map((request) => ({ ...request,
    // Once headers arrived, a missing loadingFinished event does not prove the network kept waiting.
    duration: Math.max(0, (request.endAt ?? request.responseAt ?? endAt) - request.at),
    ttfbMs: request.responseAt === undefined ? null : Math.max(0, request.responseAt - request.at),
    pending: !request.endAt,
    phase: request.endAt ? request.error ? 'failed' : 'complete' : request.responseAt ? 'response-received' : 'waiting-response',
  }));
  const markers = records.filter((record) => record.kind === 'marker').map((marker) => {
    const from = marker.at - 5000, to = marker.at + 1000;
    const native = trace.synchronized ? browserBlocks.filter((event) => overlaps(event.at!, event.duration, from, to)) : [];
    const main = tasks.filter((task) => overlaps(task.start, task.duration, from, to));
    const gaps = frames.filter((frame) => overlaps(frame.at - frame.gap, frame.gap, from, to));
    const delayed = wheels.filter((wheel) => wheel.at >= from && wheel.at <= to && wheel.deliveryDelay > 100);
    const activeRequests = network.filter((request) => overlaps(request.at, request.duration, from, to));
    const evidence: { kind: string; count: number; maxMs: number; detail: string }[] = [];
    if (native.length) evidence.push({ kind: 'browser-ui', count: native.length, maxMs: maximum(native.map((event) => event.duration)), detail: '浏览器窗口线程有阻塞；需根据原始轨迹继续查内部调用，不能据此认定具体 Windows 组件。' });
    if (main.length) evidence.push({ kind: 'renderer', count: main.length, maxMs: maximum(main.map((event) => event.duration)), detail: '网页主线程有长任务，可能影响脚本和排版；可结合长动画帧中的脚本位置判断。' });
    if (gaps.length) evidence.push({ kind: 'frame', count: gaps.length, maxMs: maximum(gaps.map((event) => event.gap)), detail: '页面动画回调有中断；动画回调正常也不能保证屏幕呈现正常。' });
    if (delayed.length) evidence.push({ kind: 'input', count: delayed.length, maxMs: maximum(delayed.map((event) => event.deliveryDelay)), detail: '滚轮事件时间与页面实际接收时间存在差距。' });
    if (activeRequests.length) evidence.push({ kind: 'network', count: activeRequests.length, maxMs: maximum(activeRequests.map((event) => event.duration)), detail: '该时间段存在网络请求；请求并发不等于它造成了滚动阻塞。' });
    const afterLoad = loaded.some((event) => event.at < from);
    return { ...marker, from, to, afterLoad, evidence, wheelCount: wheels.filter((wheel) => wheel.at >= from && wheel.at <= to).length,
      conclusion: native.length ? '卡顿标记附近发现浏览器窗口线程阻塞。' : main.length ? '卡顿标记附近发现网页主线程阻塞。' : '现有记录未定位阻塞来源，不能把内容长度或网络请求直接判作根因。' };
  });
  const warnings: string[] = [];
  if (!markers.length) warnings.push('没有标记卡顿时刻；慢操作是否对应体感卡顿尚未确认。');
  if (!trace.synchronized) warnings.push('原生轨迹缺失或无法与页面时钟对齐，无法排除浏览器窗口、输入和呈现问题。');
  if (records.some((record) => record.kind === 'dropped') || trace.dropped) warnings.push('部分记录超过容量，报告保留了缺失信息。');
  if (session.headless) warnings.push('本次为无界面采集，不能验证真实鼠标输入和 Windows 屏幕呈现。');
  if (session.phase !== 'complete') warnings.push('录制未正常结束；本报告基于已落盘的部分记录。');
  const timeline = [
    ...browserBlocks.filter((event) => event.at !== undefined).map((event) => ({ at: event.at!, duration: event.duration, layer: '浏览器窗口', detail: event.name + (event.messageId !== undefined ? ' · Windows 消息 ' + event.messageId : '') })),
    ...tasks.map((task) => ({ at: task.start, duration: task.duration, layer: '网页主线程', detail: '长任务' })),
    ...frames.map((frame) => ({ at: frame.at - frame.gap, duration: frame.gap, layer: '画面回调', detail: '动画回调间隔' })),
    ...network.filter((request) => request.duration > 300 || request.error || request.status >= 400).map((request) => ({ at: request.at, duration: request.duration, layer: '网络', detail: (request.status ?? request.error ?? '未完成') + ' ' + request.url + (request.phase === 'response-received' ? '（仅观测到响应头，完成时间未知）' : '') })),
  ].sort((a, b) => a.at - b.at);
  return { version: 1, session: { ...session, startedAt: firstAt, endedAt: endAt }, documents, snapshots, markers, warnings,
    summary: { markers: markers.length, wheels: wheels.length, scrollEvents: records.filter((record) => record.kind === 'scroll').length,
      longestBrowserBlockMs: maximum(browserBlocks.map((event) => event.duration)), longestRendererTaskMs: maximum(tasks.map((event) => event.duration)),
      longestInputDelayMs: maximum(wheels.map((event) => event.deliveryDelay)), frameGaps: frames.length,
      requests: network.length, failedRequests: network.filter((request) => request.error || request.status >= 400).length,
      loadMs: snapshots[0]?.navigation?.loadEventEnd ?? null },
    native: trace, timeline, network, errors: records.filter((record) => record.kind === 'error' || record.kind === 'console' && record.level === 'error'),
    longFrames: records.filter((record) => record.kind === 'long-frame'),
    scroll: records.filter((record) => record.kind === 'scroll' && record.target === 'document').map((record) => ({ at: record.at, y: record.y })),
  };
}

export type DiagnosticReport = ReturnType<typeof analyzeDiagnosticRecords>;

export async function writeDiagnosticReport(directory: string) {
  const session = JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8'));
  const records: DiagnosticRecord[] = [];
  let malformed = 0;
  const lines = createInterface({ input: createReadStream(join(directory, 'events.ndjson')), crlfDelay: Infinity });
  for await (const line of lines) { if (!line.trim()) continue; try { records.push(JSON.parse(line)); } catch { malformed++; } }
  const collector = new TraceEvidenceCollector();
  let traceError = '';
  const traceFiles: string[] = session.traceFiles?.length ? session.traceFiles : existsSync(join(directory, 'trace.json')) ? ['trace.json'] : [];
  for (const file of traceFiles) {
    const segmentReader = new TraceEventReader((event) => collector.consume(event));
    try { for await (const chunk of createReadStream(join(directory, file), { encoding: 'utf8' })) segmentReader.push(chunk); segmentReader.finish(); }
    catch (error) { traceError += file + ': ' + (error as Error).message + ' '; }
  }
  if (!traceFiles.length) traceError = '浏览器原生轨迹尚未保存。';
  const trace = collector.finish(records.filter((record) => record.kind === 'document' || record.kind === 'document-clock'));
  const report = analyzeDiagnosticRecords(records, trace, session);
  if (traceError) report.warnings.push(traceError);
  if (session.traceErrors?.length) report.warnings.push(...session.traceErrors);
  if (malformed) report.warnings.push('忽略了 ' + malformed + ' 条不完整记录；其余记录可以继续分析。');
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(directory, 'report.html'), diagnosticReportHtml(report));
  return report;
}

export function diagnosticReportHtml(report: DiagnosticReport) {
  const payload = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weava 页面诊断</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#222;font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:36px auto;padding:0 24px}h1{font-size:28px;margin-bottom:4px}h2{font-size:19px;margin:28px 0 12px}p{overflow-wrap:anywhere}small,.muted{color:#646b78}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,section{background:#fff;border:1px solid #dce0e6;border-radius:10px;padding:18px}.card strong{display:block;font-size:26px}.card span{color:#646b78}button{font:inherit;padding:7px 13px;border:1px solid #c9cfda;background:#fff;border-radius:6px;cursor:pointer;margin:0 8px 8px 0}button.selected{background:#203b57;color:#fff}svg{width:100%;height:170px;background:#fafbfc}input[type=range]{width:100%;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #e1e5eb;overflow-wrap:anywhere}td:last-child{max-width:650px}.warning{background:#fff4df;padding:10px 14px;border-left:3px solid #c08017}details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}@media(max-width:700px){.cards{grid-template-columns:1fr 1fr}main{padding:0 12px}.card,section{padding:12px}}</style>
<main><h1>页面诊断</h1><p id="target" class="muted"></p><div id="warnings"></div><div class="cards" id="cards"></div>
<h2>卡顿标记</h2><section><div id="markers"></div><p id="conclusion"></p><p id="evidence" class="muted"></p></section>
<h2>同一时间线</h2><section><svg id="chart" viewBox="0 0 1000 170" role="img" aria-label="浏览器和网页阻塞时间线"></svg><input id="position" type="range" min="0" step="0.1"><p id="window" class="muted"></p><table><thead><tr><th>相对时间</th><th>耗时</th><th>位置</th><th>记录</th></tr></thead><tbody id="events"></tbody></table></section>
<h2>页面与请求</h2><section><p id="dom"></p><details><summary>网络请求</summary><table><thead><tr><th>状态</th><th>耗时</th><th>地址</th></tr></thead><tbody id="network"></tbody></table></details><details><summary>错误与耗时脚本</summary><pre id="errors"></pre></details><p><a href="report.json">结构化报告</a> · <a href="events.ndjson">逐条记录</a> · <a href="trace-index.json">浏览器原始轨迹目录</a></p></section></main>
<script id="data" type="application/json">${payload}</script><script>
const r=JSON.parse(document.getElementById('data').textContent),by=id=>document.getElementById(id),start=r.session.startedAt,total=Math.max(1,r.session.endedAt-start);const rel=t=>((t-start)/1000).toFixed(2)+' s';
by('target').textContent=r.session.url+' · '+new Date(start).toLocaleString()+' · '+(r.session.browserVersion||'')+(r.session.headless?' · 无界面':'');
for(const warning of r.warnings){const p=document.createElement('p');p.className='warning';p.textContent=warning;by('warnings').append(p)}
for(const [label,value]of [['卡顿标记',r.summary.markers],['最长窗口阻塞',r.summary.longestBrowserBlockMs+' ms'],['最长网页任务',r.summary.longestRendererTaskMs+' ms'],['加载时间',r.summary.loadMs===null?'未完成':Math.round(r.summary.loadMs)+' ms']]){const c=document.createElement('div');c.className='card';const a=document.createElement('strong'),b=document.createElement('span');a.textContent=value;b.textContent=label;c.append(a,b);by('cards').append(c)}
const ns='http://www.w3.org/2000/svg',layers=['浏览器窗口','网页主线程','画面回调','网络'],colors=['#c23c45','#b46a18','#7d52ba','#3074a6'];function shape(name,attrs){const x=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))x.setAttribute(k,v);by('chart').append(x);return x}
layers.forEach((layer,i)=>{shape('text',{x:0,y:25+i*38,fill:'#555','font-size':14}).textContent=layer;shape('line',{x1:105,y1:22+i*38,x2:995,y2:22+i*38,stroke:'#dce0e6'})});
for(const e of r.timeline){const i=layers.indexOf(e.layer);if(i<0)continue;const x=105+890*(e.at-start)/total;const box=shape('rect',{x:Math.max(105,x),y:12+i*38,width:Math.max(2,890*e.duration/total),height:20,fill:colors[i]});const title=document.createElementNS(ns,'title');title.textContent=rel(e.at)+' '+Math.round(e.duration)+' ms '+e.detail;box.append(title)}
const cursor=shape('line',{x1:105,y1:0,x2:105,y2:166,stroke:'#182b40','stroke-width':2});
function rows(target,items){by(target).replaceChildren();for(const cells of items){const tr=document.createElement('tr');for(const text of cells){const td=document.createElement('td');td.textContent=text;tr.append(td)}by(target).append(tr)}}
function select(at,marker){by('position').value=Math.max(0,(at-start)/1000);const x=105+890*(at-start)/total;cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);const from=at-5000,to=at+1000;by('window').textContent='查看 '+rel(from)+' 至 '+rel(to)+'，覆盖标记前 5 秒、后 1 秒。标记可能在卡顿结束后才被处理。';rows('events',r.timeline.filter(e=>e.at<to&&e.at+e.duration>from).map(e=>[rel(e.at),Math.round(e.duration)+' ms',e.layer,e.detail]));by('conclusion').textContent=marker?marker.conclusion:'选择卡顿标记，或拖动时间轴查看证据。';by('evidence').textContent=marker?marker.evidence.map(e=>e.detail+'（'+e.count+' 次，最长 '+e.maxMs+' ms）').join(' '):''}
by('position').max=total/1000;by('position').addEventListener('input',()=>{for(const x of by('markers').children)x.classList.remove('selected');select(start+Number(by('position').value)*1000)});
for(const marker of r.markers){const b=document.createElement('button');b.textContent=rel(marker.at)+(marker.label&&marker.label!=='手动标记卡顿'?' '+marker.label:'');b.title=marker.label||'卡顿标记';b.onclick=()=>{for(const x of by('markers').children)x.classList.remove('selected');b.classList.add('selected');select(marker.at,marker)};by('markers').append(b)}
const s=r.snapshots[0];by('dom').textContent=s?s.elements+' 个元素，'+s.tables.length+' 张表格，表格共 '+s.tables.reduce((n,t)=>n+t.rows,0)+' 行，页面高 '+s.height+' px。共收到 '+r.summary.wheels+' 个滚轮事件、'+r.summary.scrollEvents+' 个滚动事件。页面规模只作背景信息，不能单独作为根因。':'没有取得页面完成加载时的快照。';
rows('network',r.network.map(q=>[q.error||q.status||'未完成',(q.phase==='response-received'?'≥':'')+Math.round(q.duration)+' ms'+(q.phase==='response-received'?'（响应已到达，完成时间未知）':q.pending?'（等待响应）':''),q.url]));by('errors').textContent=JSON.stringify({errors:r.errors,longFrames:r.longFrames},null,2);select(r.markers[0]?.at??start+Math.min(5000,total),r.markers[0]);
</script></html>`;
}
