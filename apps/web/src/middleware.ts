import { defineMiddleware } from 'astro:middleware';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { site, siteExtension } from './runtime.ts';
import { inside, normalizePath } from '@weava/core';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip);
const mime: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
const serve = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (path === '/__health')
    return Response.json({
      status: 'ready',
      site: site.root,
      releaseId: site.store.state('release'),
      pid: process.pid,
    });
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/_admin/')) {
    const framework = process.env.WEAVA_FRAMEWORK ?? resolve(process.cwd(), '../..');
    const base = join(framework, 'apps/admin/dist');
    const file = path.startsWith('/_admin/')
      ? inside(base, decodeURIComponent(path.slice(8)))
      : join(base, 'index.html');
    if (!existsSync(file)) return new Response('后台尚未构建，请运行 build。', { status: 503 });
    return new Response(readFileSync(file), {
      headers: {
        'Content-Type': mime[extname(file)] ?? 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }
  if (path.startsWith('/media/')) {
    const privateMedia = site.isPrivateMedia(path);
    if (privateMedia && !site.authenticate(context.cookies.get('weava-session')?.value ?? '') &&
      context.request.headers.get('authorization') !== 'Bearer ' + site.cliToken())
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' } });
    const file = inside(join(site.root, 'media'), decodeURIComponent(path.slice(7)));
    if (!existsSync(file) || !statSync(file).isFile())
      return new Response('Not found', { status: 404 });
    const bytes = readFileSync(file),
      type = mime[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': privateMedia ? 'private, no-store' : 'public, max-age=0, must-revalidate',
      'Vary': 'Cookie, Authorization',
      'Accept-Ranges': 'bytes',
    };
    if (type === 'text/html')
      headers['Content-Security-Policy'] =
        "sandbox allow-scripts; default-src 'self' data: https:; script-src 'unsafe-inline' https:; connect-src https:";
    const range = context.request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) return new Response(null, { status: 416 });
      const start = m[1] ? Number(m[1]) : Math.max(0, bytes.length - Number(m[2])),
        end = m[1]
          ? Math.min(bytes.length - 1, m[2] ? Number(m[2]) : bytes.length - 1)
          : bytes.length - 1;
      if (start > end || start >= bytes.length)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${bytes.length}` },
        });
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new Response(bytes, { headers });
  }
  if (!path.startsWith('/api/')) {
    const redirect = site.redirect(context.url, site.authenticate(context.cookies.get('weava-session')?.value ?? ''));
    if (redirect) return new Response(null, { status: 301, headers: { Location: redirect } });
    const custom = await (await siteExtension)?.route?.(context.request, site.visibleRelease());
    if (custom) return custom;
  }
  const response = await next();
  if (!path.startsWith('/_astro/')) response.headers.set('Cache-Control', 'no-cache');
  return response;
});
export const onRequest = defineMiddleware(async (context, next) => {
  const response = (await serve(context, next)) ?? new Response(null, { status: 500 });
  if (!context.url.pathname.startsWith('/_astro/')) {
    const vary = new Set((response.headers.get('Vary') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    vary.add('Cookie');
    response.headers.set('Vary', [...vary].join(', '));
    if (site.authenticate(context.cookies.get('weava-session')?.value ?? ''))
      response.headers.set('Cache-Control', 'private, no-store');
  }
  const type = response.headers.get('content-type') ?? '';
  if (
    context.request.method === 'HEAD' ||
    response.status !== 200 ||
    response.headers.has('content-encoding') ||
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
});
