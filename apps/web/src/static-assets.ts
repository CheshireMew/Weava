import type { APIContext } from 'astro';
import type { Site } from '../../../packages/core/src/site.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inside } from '../../../packages/runtime-common/src/paths.ts';
import { mediaResponse } from '../../../packages/core/src/media-response.ts';
import { mediaIdentity, mediaFile } from '../../../packages/core/src/paths.ts';
import { siteIconHead } from '../../../packages/core/src/seo.ts';
import { imageAttributes } from '../../../packages/core/src/media-display.ts';
import { isAdminPage } from '../../../packages/core/src/admin-access.ts';
import { assetResponse } from '../../../packages/core/src/asset-response.ts';
export const developmentNonces = new WeakMap<Response, string>();
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
export async function staticAssets(
  context: APIContext,
  site: Pick<
    Site,
    'root' | 'auth' | 'media' | 'settings' | 'isPrivateMedia' | 'authenticate' | 'cliToken'
  >,
) {
  const path = context.url.pathname;
  const adminPath = site.auth.adminPath();
  if (
    (path === '/admin' ||
      path.startsWith('/admin/') ||
      site.auth.retiredAdminPaths().some((old) => path === old || path.startsWith(old + '/'))) &&
    !isAdminPage(path, adminPath)
  )
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (import.meta.env.DEV && isAdminPage(path, adminPath)) {
    const { adminDevelopmentHtml } = await import('./admin-development.ts');
    const nonce = randomBytes(18).toString('base64');
    const html = (await adminDevelopmentHtml(context.url.pathname + context.url.search))
      .replace(
        '</head>',
        siteIconHead(imageAttributes(site, site.settings().value.logo, 64).src) + '</head>',
      )
      .replace(/<script\b/g, `<script nonce="${nonce}"`);
    const response = new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
    developmentNonces.set(response, nonce);
    return response;
  }
  if (path.startsWith('/_admin/') && !path.startsWith('/_admin/assets/'))
    return new Response('Not found', { status: 404 });
  if (isAdminPage(path, adminPath) || path.startsWith('/_admin/assets/')) {
    const framework = process.env.WEAVA_FRAMEWORK ?? resolve(process.cwd(), '../..');
    const base = process.env.WEAVA_ADMIN_DIST ?? join(framework, 'apps/admin/dist');
    const file = path.startsWith('/_admin/')
      ? inside(base, decodeURIComponent(path.slice(8)))
      : join(base, 'index.html');
    if (!existsSync(file)) return new Response('后台尚未构建，请运行 build。', { status: 503 });
    if (path.startsWith('/_admin/assets/'))
      return assetResponse(
        file,
        context.request,
        mime[extname(file)] ?? 'application/octet-stream',
      );
    return new Response(
      readFileSync(file, 'utf8').replace(
        '</head>',
        siteIconHead(imageAttributes(site, site.settings().value.logo, 64).src) + '</head>',
      ),
      {
        headers: {
          'Content-Type': mime[extname(file)] ?? 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      },
    );
  }
  if (path.startsWith('/media/')) {
    let identity: string, file: string;
    try {
      identity = mediaIdentity(path);
      file = mediaFile(process.env.WEAVA_RESOURCE_ROOT ?? site.root, identity);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const privateMedia = site.isPrivateMedia(identity);
    if (
      privateMedia &&
      !site.authenticate(context.cookies.get('weava-session')?.value ?? '') &&
      context.request.headers.get('authorization') !== 'Bearer ' + site.cliToken()
    )
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
      });
    const type = mime[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': privateMedia ? 'private, no-store' : 'public, max-age=3600, must-revalidate',
      Vary: 'Cookie, Authorization',
      'Accept-Ranges': 'bytes',
    };
    if (type === 'text/html')
      headers['Content-Security-Policy'] =
        "sandbox allow-scripts; default-src 'self' data: https:; script-src 'unsafe-inline' https:; connect-src https:";
    else if (type === 'image/svg+xml')
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    else if (!/^(image|audio|video)\//.test(type) && type !== 'text/vtt')
      headers['Content-Disposition'] = 'attachment';
    return mediaResponse(file, context.request, headers);
  }
  if (path.startsWith('/site-assets/')) {
    const file = inside(join(site.root, 'public'), decodeURIComponent(path.slice(13)));
    if (!existsSync(file)) return new Response('Not found', { status: 404 });
    return assetResponse(
      file,
      context.request,
      mime[extname(file)] ?? 'application/octet-stream',
      false,
    );
  }
  return null;
}
