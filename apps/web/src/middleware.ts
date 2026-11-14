import { defineMiddleware } from 'astro:middleware';
import { WeavaError } from '@weava/contracts';
import {
  site,
  siteExtension,
  analytics,
  features,
  maintenance,
  validating,
  ready,
  siteRenderer,
  contextFor,
} from './runtime.ts';
import { isAdminPage } from '../../../packages/core/src/admin-access.ts';
import { assertRequestTransport } from '../../../packages/core/src/request-safety.ts';
import { localizeCodeControls } from '../../../packages/core/src/public-locale.ts';
import {
  PublicResponseCache,
  conditionalPublicResponse,
} from '../../../packages/core/src/public-response-cache.ts';
import { digest } from '../../../packages/runtime-common/src/identity.ts';
import { advertiseCurrentSitemap } from './public-documents.ts';
import { requestGate, requestNetwork } from './request-policy.ts';
import { staticAssets } from './static-assets.ts';
import { publicRoute } from './public-routing.ts';
import { responseHeaders, compressResponse } from './response-policy.ts';
import { recordMissingPage, recordCrawlerPage } from './request-analytics.ts';
const publicResponses = new PublicResponseCache();
const serve = defineMiddleware(async (context, next) => {
  const gated = requestGate(context, { site, features, maintenance, validating, ready });
  if (gated) return gated;
  const asset = await staticAssets(context, site);
  if (asset) return asset;
  const routed = await publicRoute(context, {
    site,
    features,
    siteExtension,
    siteRenderer,
    contextFor,
  });
  if (routed) return routed;
  const response = await next();
  if (!context.url.pathname.startsWith('/_astro/') && !context.url.pathname.startsWith('/api/'))
    response.headers.set('Cache-Control', 'no-cache');
  return response;
});
export const onRequest = defineMiddleware(async (context, next) => {
  let response: Response;
  const admin =
    isAdminPage(context.url.pathname, site.auth.adminPath()) ||
    context.url.pathname.startsWith('/_admin/');
  const programAsset =
    context.url.pathname.startsWith('/_admin/assets/') ||
    context.url.pathname.startsWith('/_astro/');
  if (!admin && !programAsset && !/^\/(api|media|site-assets)(\/|$)/.test(context.url.pathname))
    context.locals.weavaRelease = site.visibleRelease();
  const generation =
    !import.meta.env.DEV && ready && !maintenance
      ? digest([context.locals.weavaRelease?.id, site.configuration.extensionRevisions()])
      : '';
  const cacheKey = publicResponses.key(
    context.request,
    generation,
    Number(process.env.WEAVA_PUBLIC_CACHE_SECONDS) || 0,
  );
  try {
    const cached = publicResponses.get(cacheKey);
    if (cached) {
      const { peer, identity } = requestNetwork(context);
      assertRequestTransport(context.request, identity.secure, peer, false);
    }
    response = cached ?? (await serve(context, next)) ?? new Response(null, { status: 500 });
    if (!cached && context.url.pathname === '/robots.txt' && response.status === 200) {
      if (context.request.method === 'GET')
        response = await advertiseCurrentSitemap(response, context.locals.weavaRelease ?? null);
      response.headers.set('Cache-Control', 'no-cache');
    }
    if (
      !cached &&
      !admin &&
      !programAsset &&
      !/^\/(?:media|api|site-assets)\//.test(context.url.pathname) &&
      response.status === 200 &&
      response.headers.get('content-type')?.includes('text/html')
    ) {
      const release = context.locals.weavaRelease;
      if (release) {
        const html = localizeCodeControls(
          await (await siteExtension).transformHtml(await response.text(), release, context.url),
          release.settings.language,
        );
        const headers = new Headers(response.headers);
        headers.delete('Content-Length');
        response = new Response(html, { status: response.status, headers });
      }
    }
    if (!cached && context.request.method === 'GET')
      await publicResponses.remember(cacheKey, response);
  } catch (error) {
    if (!(error instanceof WeavaError)) console.error('Request failed', error);
    response = new Response(
      error instanceof WeavaError ? error.message : '网站暂时无法完成请求。',
      {
        status: error instanceof WeavaError ? error.status : 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    );
  }
  responseHeaders(context, response, admin);
  recordMissingPage(context, response, { site, analytics, features }, admin, programAsset);
  if (!programAsset) {
    const vary = new Set(
      (response.headers.get('Vary') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    vary.add('Cookie');
    response.headers.set('Vary', [...vary].join(', '));
    if (
      !context.url.pathname.startsWith('/media/') &&
      site.authenticate(context.cookies.get('weava-session')?.value ?? '')
    )
      response.headers.set('Cache-Control', 'private, no-store');
  }
  if (
    cacheKey &&
    response.status === 200 &&
    !response.headers.has('set-cookie') &&
    /html|xml|text\/plain/i.test(response.headers.get('content-type') ?? '') &&
    !/private|no-store/i.test(response.headers.get('cache-control') ?? '')
  ) {
    const body = await response.clone().text();
    response = conditionalPublicResponse(context.request, response, body);
  }
  recordCrawlerPage(context, response, { site, analytics, features }, admin, programAsset);
  return compressResponse(context, response);
});
