import { load } from 'cheerio';
import { WeavaError, type Release } from '@weava/contracts';

export interface AuditResponse { html?: string; status: number; error?: string; url?: string; headers?: Record<string, string> }
export interface CrawlState {
  releaseId: string; origin: string; pending: string[]; visited: string[]; complete: boolean;
  documents?: { robots?: { status: number; text: string }; sitemaps: Record<string, { status: number; urls: string[]; index: boolean }> };
}
const reserved = /^\/(?:api|admin|__preview|__health|_admin|_site|_astro|media|site-assets)(?:\/|$)/;
async function boundedText(response: Response, maximum = 2_000_000) {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new Error('响应超过 2 MB 检查预算。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Checkpoints contain URLs only; response bodies never accumulate in saved reports. */
export async function fetchAuditBatch(release: Release, origin: string, options: {
  maxPages?: number; previous?: CrawlState; paths?: string[]; fetcher?: typeof fetch;
} = {}) {
  const maximum = options.maxPages ?? 200;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) throw new WeavaError('每批检查地址数为 1～1000。');
  const local = new URL(origin).origin, domain = new URL(release.settings.domain).origin;
  const previous = options.previous;
  if (previous && (previous.releaseId !== release.id || previous.origin !== local)) throw new WeavaError('检查续查的公开版本或访问地址已变化，请重新检查。', 409);
  const pending = [...(previous?.pending ?? [])], visited = new Set(previous?.visited ?? []), queued = new Set([...pending, ...visited]);
  const documents = structuredClone(previous?.documents ?? { sitemaps: {} });
  const entries = new Map<string, string>(), hidden = new Set<string>();
  for (const entry of release.entries) {
    const pathname = new URL(entry.path, domain).pathname;
    if (entry.visibility === 'private') hidden.add(pathname);
    else entries.set(pathname, entry.id);
  }
  const enqueue = (value: string, base = domain) => {
    let url: URL; try { url = new URL(value, base); } catch { return; }
    if (![domain, local].includes(url.origin) || reserved.test(url.pathname) || hidden.has(url.pathname) || /\.(?:png|jpe?g|webp|avif|gif|svg|pdf|zip|mp[34]|webm|woff2?|css|js)$/i.test(url.pathname)) return;
    url.hash = ''; const path = url.pathname + url.search;
    if (queued.has(path)) return;
    if (queued.size >= 50000) throw new WeavaError('发现地址超过 50000 个，请缩小站点检查范围。');
    queued.add(path); pending.push(path);
  };
  if (!previous) {
    enqueue('/robots.txt'); enqueue('/sitemap.xml');
    for (const path of entries.keys()) enqueue(path);
    for (const path of options.paths ?? []) enqueue(path);
  }
  const responses: Record<string, AuditResponse> = {}, fetcher = options.fetcher ?? fetch;
  let requested = 0;
  while (pending.length && requested < maximum) {
    const batch = pending.splice(0, Math.min(4, maximum - requested)); requested += batch.length;
    await Promise.all(batch.map(async path => {
      visited.add(path);
      const key = !new URL(path, domain).search && entries.has(path) ? entries.get(path)! : 'url:' + new URL(path, domain).href;
      try {
        const response = await fetcher(new URL(path, local), { redirect: 'manual', headers: { 'User-Agent': 'Weava-Site-Audit/1' }, signal: AbortSignal.timeout(8000) });
        const headers = Object.fromEntries(['content-type', 'x-robots-tag', 'location'].flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)!]] : []));
        const html = await boundedText(response);
        responses[key] = { status: response.status, html, headers, url: new URL(path, domain).href };
        if (response.status >= 300 && response.status < 400 && headers.location) enqueue(headers.location, new URL(path, domain).href);
        if (path === '/robots.txt') {
          documents.robots = { status: response.status, text: html };
          if (response.ok) for (const line of html.split(/\r?\n/)) { const map = /^\s*Sitemap:\s*(\S+)/i.exec(line); if (map) enqueue(map[1]); }
          return;
        }
        if (!response.ok) {
          if (/sitemap/i.test(path)) documents.sitemaps[path] = { status: response.status, urls: [], index: false };
          return;
        }
        if (/sitemap/i.test(path) || /xml/i.test(headers['content-type'] ?? '')) {
          const xml = load(html, { xmlMode: true }), urls = xml('loc').map((_i, element) => xml(element).text().trim()).get();
          documents.sitemaps[path] = { status: response.status, urls, index: xml('sitemapindex').length > 0 };
          for (const value of urls) enqueue(value, domain);
        } else if (!headers['content-type'] || /html/i.test(headers['content-type'])) {
          const $ = load(html);
          $('a[href],link[rel="canonical"]').each((_i, element) => enqueue($(element).attr('href')!, new URL(path, domain).href));
        }
      } catch (error) { responses[key] = { status: 0, error: error instanceof Error ? error.message : '读取失败。', url: new URL(path, domain).href }; }
    }));
  }
  return { responses, state: { releaseId: release.id, origin: local, pending, visited: [...visited], complete: pending.length === 0, documents } satisfies CrawlState };
}
