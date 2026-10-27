import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
const capture = 'D:/Tools/cache/weava/crypto-capture/site';
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt',
};
const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  let file = resolve(capture, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(resolve(capture))) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const bytes = readFileSync(file),
    compress = /\.(html|css|js|json|svg|xml)$/.test(file);
  const output = compress ? gzipSync(bytes) : bytes;
  res.writeHead(200, {
    'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
    ...(compress ? { 'Content-Encoding': 'gzip' } : {}),
    'Content-Length': output.length,
  });
  res.end(output);
});
await new Promise<void>((r) => server.listen(4324, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const routes = ['/', '/guides/invitation-codes/', '/learn/', '/videos/', '/stocks/'];
const reports: any[] = [];
try {
  for (const path of routes)
    for (const [name, port] of [
      ['reference', 4324],
      ['weava', 4323],
    ] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
        page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 40,
        downloadThroughput: 1250000,
        uploadThroughput: 625000,
      });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (
          !['127.0.0.1', 'localhost'].includes(url.hostname) ||
          url.pathname.startsWith('/video/') ||
          url.pathname.startsWith('/api/')
        )
          return route.abort();
        return route.continue();
      });
      await page.addInitScript(() => {
        (window as any).__lcp = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) (window as any).__lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      const data = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return {
          ttfb: nav.responseStart,
          lcp: (window as any).__lcp,
          load: nav.loadEventEnd,
          transferBytes: nav.transferSize + resources.reduce((sum, r) => sum + r.transferSize, 0),
          scripts: resources
            .filter((r) => r.initiatorType === 'script')
            .map((r) => ({ url: new URL(r.name).pathname, bytes: r.transferSize })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      reports.push({ name, path, ...data });
      await context.close();
    }
  const dir = 'D:/Tools/cache/weava/acceptance';
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'performance.json'),
    JSON.stringify(
      {
        conditions: {
          network: '10Mbps, 40ms latency, cold cache',
          browser: 'Windows Chrome',
          externalRequests: 'blocked equally',
          note: 'Single lab run; not field Core Web Vitals. Video/live APIs excluded equally.',
        },
        pages: reports,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  server.close();
}
