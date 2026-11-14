import type { APIContext } from 'astro';
import type { Site } from '../../../packages/core/src/site.ts';
import type { Analytics } from '../../../packages/core/src/analytics.ts';
import { requestIdentity } from '../../../packages/core/src/request-identity.ts';
import { normalizePath } from '../../../packages/core/src/paths.ts';
import { declaredCrawler } from '../../../packages/core/src/analytics-agents.ts';
import { releaseIndex } from '../../../packages/core/src/release-index.ts';
interface TelemetryServices {
  site: Pick<Site, 'authenticate' | 'release' | 'settings'>;
  analytics: Pick<Analytics, 'recordMissing' | 'recordCrawler'>;
  features: string[];
}
export function recordMissingPage(
  context: APIContext,
  response: Response,
  services: TelemetryServices,
  admin: boolean,
  programAsset: boolean,
) {
  const { site, analytics, features } = services;
  if (
    response.status === 404 &&
    context.request.method === 'GET' &&
    !admin &&
    !programAsset &&
    !/^\/(api|media|site-assets|__|_)/.test(context.url.pathname) &&
    response.headers.get('content-type')?.includes('text/html') &&
    features.includes('analytics') &&
    context.request.headers.get('dnt') !== '1' &&
    context.cookies.get('weava-exclude')?.value !== '1' &&
    !site.authenticate(context.cookies.get('weava-session')?.value ?? '') &&
    !site
      .release()
      ?.entries.some(
        (entry) => entry.path === context.url.pathname && entry.visibility === 'private',
      )
  ) {
    let peer = '';
    try {
      peer = context.clientAddress;
    } catch {}
    try {
      analytics.recordMissing(
        context.url.pathname,
        context.request.headers.get('referer') ?? '',
        context.request.headers.get('user-agent') ?? '',
        requestIdentity(context.request, peer).network,
        site.settings().value.timezone,
      );
    } catch {}
  }
}
export function recordCrawlerPage(
  context: APIContext,
  response: Response,
  services: TelemetryServices,
  admin: boolean,
  programAsset: boolean,
) {
  const { analytics, features } = services;
  if (
    !admin &&
    !programAsset &&
    features.includes('analytics') &&
    context.request.method === 'GET' &&
    (response.status === 304 || response.headers.get('content-type')?.includes('text/html'))
  ) {
    const agent = declaredCrawler(context.request.headers.get('user-agent') ?? '');
    const release = agent && context.locals.weavaRelease;
    if (agent && release)
      try {
        const page = releaseIndex(release).byPath.get(normalizePath(context.url.pathname));
        if (page && page.visibility !== 'private') {
          let peer = '';
          try {
            peer = context.clientAddress;
          } catch {}
          analytics.recordCrawler(
            page.path,
            agent,
            response.status,
            requestIdentity(context.request, peer).network,
          );
        }
      } catch {}
  }
}
