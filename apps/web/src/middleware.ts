import { defineMiddleware } from 'astro:middleware';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { site, siteExtension, analytics } from './runtime.ts';
import { inside, normalizePath, mediaResponse, mediaIdentity, mediaFile, siteIconHead } from '@weava/core';
import { WeavaError } from '@weava/contracts';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { assertRequestOrigin } from '../../../packages/core/src/request-safety.ts';
import { requestIdentity } from '@weava/core';
import { isAdminPage } from '../../../packages/core/src/admin-access.ts';
import { assetResponse } from '../../../packages/core/src/asset-response.ts';
import { releaseIndex } from '../../../packages/core/src/release-index.ts';
const compress = promisify(gzip);
const developmentNonces = new WeakMap<Response, string>();
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
  let peer='';try{peer=context.clientAddress;}catch{}
  assertRequestOrigin(context.request,requestIdentity(context.request,peer).protocol);
  const path = context.url.pathname;
  if (path === '/__health')
    return Response.json({
      status: 'ready',
      releaseId: site.store.state('release'),
      ...(site.authenticate(context.cookies.get('weava-session')?.value??'') || context.request.headers.get('authorization')==='Bearer '+site.cliToken()?{site:site.root,pid:process.pid}:{}),
    },{headers:{'Cache-Control':'no-store','Vary':'Cookie, Authorization'}});
  const adminPath=site.auth.adminPath();
  if ((path==='/admin'||path.startsWith('/admin/')||site.auth.retiredAdminPaths().some(old=>path===old||path.startsWith(old+'/'))) && !isAdminPage(path,adminPath))
    return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
  if (import.meta.env.DEV && isAdminPage(path, adminPath)) {
    const { adminDevelopmentHtml } = await import('./admin-development.ts');
    const nonce = randomBytes(18).toString('base64');
    const html = (await adminDevelopmentHtml(context.url.pathname + context.url.search))
      .replace('</head>', siteIconHead(site.settings().value.logo) + '</head>')
      .replace(/<script\b/g, `<script nonce="${nonce}"`);
    const response = new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    } });
    developmentNonces.set(response, nonce);
    return response;
  }
  if(path.startsWith('/_admin/')&&!path.startsWith('/_admin/assets/'))return new Response('Not found',{status:404});
  if (isAdminPage(path,adminPath) || path.startsWith('/_admin/assets/')) {
    const framework = process.env.WEAVA_FRAMEWORK ?? resolve(process.cwd(), '../..');
    const base = process.env.WEAVA_ADMIN_DIST ?? join(framework, 'apps/admin/dist');
    const file = path.startsWith('/_admin/')
      ? inside(base, decodeURIComponent(path.slice(8)))
      : join(base, 'index.html');
    if (!existsSync(file)) return new Response('后台尚未构建，请运行 build。', { status: 503 });
    if(path.startsWith('/_admin/assets/'))return assetResponse(file,context.request,mime[extname(file)]??'application/octet-stream');
    return new Response(readFileSync(file, 'utf8').replace('</head>', siteIconHead(site.settings().value.logo) + '</head>'), {
      headers: {
        'Content-Type': mime[extname(file)] ?? 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }
  if (path.startsWith('/media/')) {
    let identity: string, file: string;
    try { identity = mediaIdentity(path); file = mediaFile(site.root, identity); }
    catch { return new Response('Not found', { status: 404 }); }
    const privateMedia = site.isPrivateMedia(identity);
    if (privateMedia && !site.authenticate(context.cookies.get('weava-session')?.value ?? '') &&
      context.request.headers.get('authorization') !== 'Bearer ' + site.cliToken())
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' } });
    const type = mime[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': privateMedia ? 'private, no-store' : 'public, max-age=0, must-revalidate',
      'Vary': 'Cookie, Authorization',
      'Accept-Ranges': 'bytes',
    };
    if (type === 'text/html')
      headers['Content-Security-Policy'] =
        "sandbox allow-scripts; default-src 'self' data: https:; script-src 'unsafe-inline' https:; connect-src https:";
    else if(type==='image/svg+xml')headers['Content-Security-Policy']="sandbox; default-src 'none'; style-src 'unsafe-inline'";
    else if(!/^(image|audio|video)\//.test(type) && type!=='text/vtt') headers['Content-Disposition']='attachment';
    return mediaResponse(file, context.request, headers);
  }
  if (!path.startsWith('/api/')) {
    const redirect = site.redirect(context.url, site.authenticate(context.cookies.get('weava-session')?.value ?? ''));
    if (redirect) return new Response(null, { status: 301, headers: { Location: redirect } });
    // An unavailable WordPress ID is a missing page, rather than a copy of the homepage.
    if (path === '/' && (context.url.searchParams.has('p') || context.url.searchParams.has('page_id')))
      return new Response('页面未找到', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex,nofollow' } });
    const custom = await (await siteExtension)?.route?.(context.request, site.visibleRelease());
    if (custom) return custom;
  }
  const response = await next();
  if (!path.startsWith('/_astro/') && !path.startsWith('/api/')) response.headers.set('Cache-Control', 'no-cache');
  return response;
});
export const onRequest = defineMiddleware(async (context, next) => {
  let response: Response;
  try { response = (await serve(context, next)) ?? new Response(null, { status: 500 }); }
  catch (error) {
    if (!(error instanceof WeavaError)) console.error('Request failed',error);
    response = new Response(error instanceof WeavaError?error.message:'网站暂时无法完成请求。', { status: error instanceof WeavaError?error.status:500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options','SAMEORIGIN');
  const admin=isAdminPage(context.url.pathname,site.auth.adminPath())||context.url.pathname.startsWith('/_admin/');
  if(admin)response.headers.set('Referrer-Policy','no-referrer');
  if(admin) {
    const nonce = developmentNonces.get(response);
    const scripts = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
    const connections = import.meta.env.DEV ? `'self' ${context.url.protocol === 'https:' ? 'wss' : 'ws'}://${context.url.host}` : "'self'";
    response.headers.set('Content-Security-Policy',`default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src ${connections}; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`);
  }
  else if(!context.url.pathname.startsWith('/media/'))response.headers.set('Content-Security-Policy',(response.headers.get('Content-Security-Policy')??'')+"; frame-ancestors 'self'; base-uri 'self'");
  const programAsset=context.url.pathname.startsWith('/_admin/assets/')||context.url.pathname.startsWith('/_astro/');
  const published=!admin&&!programAsset&&context.request.method==='GET'&&response.headers.get('content-type')?.includes('text/html')?site.visibleRelease():null;
  if (published && releaseIndex(published).byPath.has(context.url.pathname)) {
    try { analytics.recordCrawler(context.url.pathname, context.request.headers.get('user-agent') ?? '', response.status); } catch {}
  }
  if (!programAsset) {
    const vary = new Set((response.headers.get('Vary') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    vary.add('Cookie');
    response.headers.set('Vary', [...vary].join(', '));
    if (site.authenticate(context.cookies.get('weava-session')?.value ?? ''))
      response.headers.set('Cache-Control', 'private, no-store');
  }
  const type = response.headers.get('content-type') ?? '';
  if (
    context.request.method === 'HEAD' || context.url.pathname.startsWith('/media/') ||
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
