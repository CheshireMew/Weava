/** Serialized into the target page by CDP; keep all browser dependencies inside this function. */
export function installDiagnosticProbe(config: { binding: string; controls: boolean }) {
  const scope = window as any;
  if (scope.__weavaDiagnosticProbe) return;
  scope.__weavaDiagnosticProbe = true;
  const documentId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const clockName = 'weava:diagnostic-clock:' + documentId;
  performance.mark(clockName);
  const clockMs = performance.getEntriesByName(clockName)[0].startTime;
  let records: any[] = [], dropped = 0, sequence = 0, finished = false, frameCount = 0, lastClock = clockMs;
  const now = () => performance.timeOrigin + performance.now();
  const emit = (value: any) => { try { scope[config.binding](JSON.stringify(value)); } catch {} };
  const record = (kind: string, value: Record<string, unknown> = {}) => {
    if (finished) return;
    if (records.length < 5000) records.push({ kind, at: now(), ...value }); else dropped++;
  };
  const flush = () => {
    if (performance.now() - lastClock >= 5000) {
      const name = clockName + ':' + sequence; performance.mark(name);
      lastClock = performance.getEntriesByName(name)[0].startTime;
      record('document-clock', { timeOrigin: performance.timeOrigin, clockName: name, clockMs: lastClock });
    }
    if (!records.length && !dropped) return;
    emit({ kind: 'page-batch', documentId, sequence: sequence++, records, dropped });
    records = []; dropped = 0;
  };
  record('document', { documentId, timeOrigin: performance.timeOrigin, clockName, clockMs, url: location.href,
    userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    hardwareConcurrency: navigator.hardwareConcurrency, visibility: document.visibilityState });
  const observe = (type: string, callback: (entry: any) => void) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
    try { new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({ type, buffered: true }); } catch {}
  };
  observe('longtask', (entry) => record('longtask', { start: performance.timeOrigin + entry.startTime, duration: entry.duration }));
  observe('long-animation-frame', (entry) => record('long-frame', { start: performance.timeOrigin + entry.startTime,
    duration: entry.duration, blockingDuration: entry.blockingDuration, renderStart: entry.renderStart,
    scripts: (entry.scripts ?? []).map((script: any) => ({ url: script.sourceURL, function: script.sourceFunctionName,
      invoker: script.invoker, duration: script.duration, forcedLayoutMs: script.forcedStyleAndLayoutDuration })) }));
  observe('layout-shift', (entry) => record('layout-shift', { start: performance.timeOrigin + entry.startTime,
    value: entry.value, recentInput: entry.hadRecentInput }));
  observe('largest-contentful-paint', (entry) => record('lcp', { start: performance.timeOrigin + entry.startTime, size: entry.size }));
  let previous = 0;
  const frame = (time: number) => {
    if (finished) return;
    const gap = previous ? time - previous : 0;
    if (gap > 35 || frameCount++ % 3 === 0) record('frame', { gap, x: scrollX, y: scrollY, visibility: document.visibilityState });
    previous = time; requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('wheel', (event) => {
    const stamp = event.timeStamp > 1e12 ? event.timeStamp : performance.timeOrigin + event.timeStamp;
    const target = event.target instanceof Element ? event.target : null;
    record('wheel', { eventAt: stamp, deliveryDelay: Math.max(0, now() - stamp), dx: event.deltaX, dy: event.deltaY,
      mode: event.deltaMode, x: event.clientX, y: event.clientY, scrollY, tag: target?.tagName,
      inTable: !!target?.closest('table'), trusted: event.isTrusted });
  }, { passive: true, capture: true });
  addEventListener('scroll', (event) => record('scroll', { x: scrollX, y: scrollY,
    target: event.target === document ? 'document' : (event.target as Element)?.tagName }), { passive: true, capture: true });
  addEventListener('pointerdown', () => record('pointer', { x: scrollX, y: scrollY }), { passive: true });
  addEventListener('visibilitychange', () => { record('visibility', { value: document.visibilityState }); previous = 0; });
  addEventListener('resize', () => record('resize', { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }), { passive: true });
  const mark = () => {
    if (finished) return;
    const at = now(); record('marker', { label: '手动标记卡顿', source: 'page', x: scrollX, y: scrollY });
    performance.mark('weava:stall:' + Math.round(at)); flush();
    if (markButton) { const button = markButton; button.textContent = '已标记'; setTimeout(() => { button.textContent = '标记卡顿'; }, 1000); }
  };
  const finish = () => {
    if (finished) return;
    record('finish'); flush(); finished = true;
    if (statusNode) statusNode.textContent = '记录已结束';
    if (markButton) markButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    emit({ kind: 'finish', at: now() });
  };
  scope.__weavaDiagnosticFlush = flush;
  scope.__weavaDiagnosticFinish = finish;
  addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey) return;
    if (event.code === 'KeyM') { event.preventDefault(); mark(); }
    if (event.code === 'KeyQ') { event.preventDefault(); finish(); }
  });
  addEventListener('pagehide', () => { record('pagehide'); flush(); });
  const flushTimer = setInterval(() => { if (finished) clearInterval(flushTimer); else flush(); }, 1000);
  let markButton: HTMLButtonElement | undefined;
  let stopButton: HTMLButtonElement | undefined, statusNode: HTMLElement | undefined;
  const loaded = () => {
    if (finished) return;
    const snapshotStart = now();
    const article = document.querySelector('[data-article-body]') ?? document.querySelector('.prose') ?? document.body;
    record('snapshot', { startedAt: snapshotStart, title: document.title, elements: document.querySelectorAll('*').length,
      articleElements: article.querySelectorAll('*').length, height: document.documentElement.scrollHeight,
      images: [...document.images].map((image) => ({ src: image.currentSrc || image.src, complete: image.complete,
        width: image.naturalWidth, height: image.naturalHeight, reservedWidth: image.getAttribute('width'), reservedHeight: image.getAttribute('height') })),
      tables: [...article.querySelectorAll('table')].map((table, index) => ({ index, rows: table.rows.length,
        top: table.getBoundingClientRect().top + scrollY, height: table.clientHeight, width: table.clientWidth, scrollWidth: table.scrollWidth })),
      navigation: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.toJSON(),
      inspectionMs: now() - snapshotStart });
    record('loaded'); flush();
    if (!config.controls) return;
    const host = document.createElement('div'); host.dataset.weavaDiagnostic = '';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;contain:content';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = ':host{all:initial}section{display:flex;gap:8px;align-items:center;padding:9px;background:#fff;color:#222;border:1px solid #aaa;border-radius:8px;box-shadow:0 2px 8px #0002;font:13px system-ui}button{font:inherit;border:1px solid #ccc;border-radius:5px;background:#f5f5f5;color:#222;padding:7px 10px;cursor:pointer}';
    const panel = document.createElement('section'); panel.setAttribute('aria-label', '页面性能诊断');
    const status = document.createElement('span'); statusNode = status; status.textContent = '诊断记录中'; status.setAttribute('role', 'status');
    markButton = document.createElement('button'); markButton.textContent = '标记卡顿'; markButton.title = 'Alt+Shift+M；标记后分析此前 5 秒'; markButton.addEventListener('click', mark);
    stopButton = document.createElement('button'); stopButton.textContent = '结束诊断'; stopButton.title = 'Alt+Shift+Q'; stopButton.addEventListener('click', finish);
    panel.append(status, markButton, stopButton); root.append(style, panel); document.documentElement.append(host);
  };
  // loadEventEnd is only populated after all load handlers have returned.
  if (document.readyState === 'complete') setTimeout(loaded, 0); else addEventListener('load', () => setTimeout(loaded, 0), { once: true });
  flush();
}
