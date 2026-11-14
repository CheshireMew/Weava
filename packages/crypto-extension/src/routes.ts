import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { CryptoState } from './state.ts';
import { response } from './http.ts';
import { normalize, configFor } from './referrals.ts';
import { stockPublic } from './equity-catalog.ts';
import { videoRoute } from './video.ts';
const mime: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
export function cryptoRoutes(state: CryptoState, legacy = false) {
  const video = videoRoute(state.videoSources);
  return async (request: Request, release: any) => {
    if (!release) return null;
    const url = new URL(request.url),
      path = url.pathname;
    if (path === '/api/announcements') {
      const d = structuredClone(state.feeds);
      for (const feed of d.feeds ?? []) {
        feed.stale = !!feed.error || Date.now() - Date.parse(feed.updatedAt ?? '') > 1800000;
        feed.status = !feed.items?.length ? 'unavailable' : feed.stale ? 'cached' : 'current';
        feed.url = normalize(feed.url, configFor(release));
        for (const item of feed.items ?? []) item.url = normalize(item.url, configFor(release));
        delete feed.error;
      }
      return response(d);
    }
    if (path === '/api/equities/catalog' || path === '/equity-catalog.json')
      return response(stockPublic(state, release));
    const redirected = await video(url);
    if (redirected) return redirected;
    const documents = legacy
      ? ['/sitemap.xml', '/rss.xml', '/robots.txt']
      : ['/sitemap.xml', '/sitemap-videos.xml', '/search-index.json', '/rss.xml', '/robots.txt'];
    if (documents.includes(path)) return null;
    if (
      !legacy &&
      (path === '/announcements.js' ||
        path === '/crypto-business.js' ||
        path === '/equities.js' ||
        path === '/equities.css')
    ) {
      const file = join(state.root, 'extensions/templates', path.slice(1));
      if (existsSync(file))
        return new Response(readFileSync(file), {
          headers: { 'Content-Type': mime[extname(file)] || 'application/octet-stream' },
        });
    }
    const theme = join(state.root, legacy ? 'themes/crypto' : 'extensions/assets'),
      file = resolve(theme, '.' + decodeURIComponent(path));
    if (file.startsWith(theme) && existsSync(file) && !path.endsWith('/')) {
      try {
        return new Response(readFileSync(file), {
          headers: {
            'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
            'Cache-Control': path.endsWith('.json') ? 'no-cache' : 'public, max-age=3600',
          },
        });
      } catch {}
    }
    return null;
  };
}
