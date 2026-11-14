import type { APIContext } from 'astro';
import type { Site } from '../../../packages/core/src/site.ts';
import type { ExtensionManager } from '../../../packages/core/src/extension-manager.ts';
import type { SiteRenderer } from '../../../packages/core/src/site-render.ts';
import type { WebsiteContext } from '../../../packages/core/src/site-sdk.ts';
import type { Entry, Release } from '@weava/contracts';
import { publicUrlRedirect } from '../../../packages/core/src/public-url.ts';
import { requestNetwork } from './request-policy.ts';
export async function publicRoute(
  context: APIContext,
  services: {
    site: Pick<Site, 'redirect' | 'authenticate'>;
    siteExtension: Promise<ExtensionManager>;
    siteRenderer: Promise<SiteRenderer | null>;
    contextFor: (
      request: Request,
      preview?: boolean,
      entry?: Entry,
      snapshot?: Release | null,
    ) => WebsiteContext;
    features: string[];
  },
) {
  const { site, siteExtension, siteRenderer, contextFor, features } = services;
  const path = context.url.pathname;
  const normalized = publicUrlRedirect(context.request, context.locals.weavaRelease ?? null, {
    protocol: requestNetwork(context).identity.protocol,
    enforceOrigin: !import.meta.env.DEV,
  });
  if (normalized) return new Response(null, { status: 301, headers: { Location: normalized } });
  if (!/^\/(?:api\/admin|api\/v1|media|__preview|_admin|__health)(?:\/|$)/.test(path)) {
    const renderer = await siteRenderer;
    if (renderer) {
      const response = await renderer.render(
        context.request,
        contextFor(context.request, false, undefined, context.locals.weavaRelease),
      );
      if (response !== null) return response;
    }
  }
  if (!features.includes('content') && path === '/')
    return new Response(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Weava</title><main><h1>网站已就绪</h1></main></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  if (!path.startsWith('/api/')) {
    const redirect = site.redirect(
      context.url,
      site.authenticate(context.cookies.get('weava-session')?.value ?? ''),
      context.locals.weavaRelease,
    );
    if (redirect) return new Response(null, { status: 301, headers: { Location: redirect } });
    // An unavailable WordPress ID is a missing page, rather than a copy of the homepage.
    if (
      path === '/' &&
      (context.url.searchParams.has('p') || context.url.searchParams.has('page_id'))
    )
      return new Response('页面未找到', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Robots-Tag': 'noindex,nofollow',
        },
      });
    const custom = await (
      await siteExtension
    )?.route?.(context.request, context.locals.weavaRelease ?? null);
    if (custom) return custom;
  }
  return null;
}
