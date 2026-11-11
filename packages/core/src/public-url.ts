import type { Release } from '@weava/contracts';
import { normalizePath } from './paths.ts';

/** Redirect known content only. Loopback probes and local authoring never leave the machine. */
export function publicUrlRedirect(request: Request, release: Release | null, options: { protocol?: string; enforceOrigin?: boolean } = {}) {
  if (!release || !['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url), path = normalizePath(url.pathname);
  if (!release.entries.some(entry => entry.path === path && entry.visibility !== 'private')) return null;
  const target = new URL(path + url.search, release.settings.domain);
  const host = request.headers.get('host') || url.host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const originDiffers = options.enforceOrigin && !local && ((options.protocol || url.protocol) !== target.protocol || host !== target.host);
  if (originDiffers) return target.href;
  return url.pathname !== target.pathname ? target.pathname + target.search : null;
}
