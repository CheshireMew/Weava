import type { APIContext } from 'astro';
import type { Site } from '../../../packages/core/src/site.ts';
import { requiredFeature } from '../../../packages/core/src/site-features.ts';
import { requestIdentity } from '../../../packages/core/src/request-identity.ts';
import {
  assertRequestOrigin,
  assertRequestTransport,
} from '../../../packages/core/src/request-safety.ts';
export function requestNetwork(context: APIContext) {
  let peer = '';
  try {
    peer = context.clientAddress;
  } catch {}
  return { peer, identity: requestIdentity(context.request, peer) };
}
export function requestGate(
  context: APIContext,
  services: {
    site: Pick<Site, 'root' | 'publication' | 'authenticate' | 'cliToken'>;
    features: string[];
    ready: boolean;
    maintenance: boolean;
    validating: boolean;
  },
) {
  const { site, features, ready, maintenance, validating } = services;
  const { peer, identity } = requestNetwork(context);
  const probe =
    validating &&
    ['GET', 'HEAD'].includes(context.request.method) &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) &&
    !!process.env.WEAVA_UPGRADE_PROBE &&
    context.request.headers.get('x-weava-upgrade-probe') === process.env.WEAVA_UPGRADE_PROBE;
  assertRequestTransport(
    context.request,
    identity.secure,
    peer,
    probe || context.request.headers.get('authorization') === 'Bearer ' + site.cliToken(),
  );
  assertRequestOrigin(context.request, identity.protocol);
  const path = context.url.pathname;
  if (!ready && path !== '/__health')
    return new Response('网站正在初始化，请稍后重试。', {
      status: 503,
      headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    });
  if (
    maintenance &&
    path !== '/__health' &&
    !probe &&
    !(
      validating &&
      context.request.method === 'GET' &&
      context.request.headers.get('authorization') === 'Bearer ' + site.cliToken()
    )
  )
    return new Response('网站正在维护，请稍后重试。', {
      status: 503,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  const feature = requiredFeature(path);
  if (feature && !features.includes(feature)) return new Response('Not found', { status: 404 });
  if (path === '/__health')
    return Response.json(
      {
        status: ready ? 'ready' : 'starting',
        releaseId: site.publication.currentId(),
        ...(site.authenticate(context.cookies.get('weava-session')?.value ?? '') ||
        context.request.headers.get('authorization') === 'Bearer ' + site.cliToken()
          ? { site: site.root, pid: process.pid, nonce: process.env.WEAVA_RUN_NONCE ?? '' }
          : {}),
      },
      {
        status: ready ? 200 : 503,
        headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' },
      },
    );
  return null;
}
