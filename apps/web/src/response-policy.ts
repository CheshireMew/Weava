import type { APIContext } from 'astro';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { developmentNonces } from './static-assets.ts';
const compress = promisify(gzip);
export function responseHeaders(context: APIContext, response: Response, admin: boolean) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (admin) response.headers.set('Referrer-Policy', 'no-referrer');
  if (admin) {
    const nonce = developmentNonces.get(response);
    const scripts = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
    const connections = import.meta.env.DEV
      ? `'self' ${context.url.protocol === 'https:' ? 'wss' : 'ws'}://${context.url.host}`
      : "'self'";
    response.headers.set(
      'Content-Security-Policy',
      `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src ${connections}; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`,
    );
  } else if (!context.url.pathname.startsWith('/media/'))
    response.headers.set(
      'Content-Security-Policy',
      (response.headers.get('Content-Security-Policy') ?? '') +
        "; frame-ancestors 'self'; base-uri 'self'",
    );
}
export async function compressResponse(context: APIContext, response: Response) {
  const type = response.headers.get('content-type') ?? '';
  if (
    context.request.method === 'HEAD' ||
    context.url.pathname.startsWith('/media/') ||
    response.status !== 200 ||
    response.headers.has('content-encoding') ||
    response.headers.get('X-Weava-Stream') === '1' ||
    !/(^text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i.test(type)
  )
    return response;
  const headers = new Headers(response.headers);
  headers.set(
    'Vary',
    [
      ...new Set(
        (headers.get('Vary') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .concat('Accept-Encoding'),
      ),
    ].join(', '),
  );
  const accepts = context.request.headers.get('accept-encoding') ?? '';
  const gzipAllowed = accepts.split(',').some((part) => {
    const [name, ...params] = part.trim().split(';');
    return name === 'gzip' && !params.some((p) => /^\s*q=0(?:\.0*)?\s*$/.test(p));
  });
  if (!gzipAllowed) return new Response(response.body, { status: response.status, headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) return new Response(bytes, { status: response.status, headers });
  const zipped = await compress(bytes);
  headers.set('Content-Encoding', 'gzip');
  headers.set('Content-Length', String(zipped.length));
  return new Response(zipped, { status: response.status, headers });
}
