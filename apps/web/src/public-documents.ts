import type { PublishedEntry, Release } from '@weava/contracts';
import { systemRoutes } from '@weava/contracts';
import { escape as e, scopedFeed, sanitize, pageMetadata, type PageMetadata } from '@weava/core';
import { load } from 'cheerio';
import { releaseIndex } from '../../../packages/core/src/release-index.ts';

/** Older migrated sites still serve robots.txt from their site-owned extension. */
export async function advertiseCurrentSitemap(response: Response, release: Release | null | undefined): Promise<Response> {
  if (!release || response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/plain') ||
      releaseIndex(release).byPath.get('/')?.source?.wordpressCompatibility?.robotsText === undefined) return response;
  const robots = await response.clone().text();
  const sitemap = new URL(systemRoutes.sitemap, release.settings.domain).href;
  if (!/^\s*sitemap\s*:/im.test(robots) ||
      [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].some(([, value]) => value === sitemap)) return response;
  const separator = robots.includes('\r\n') ? '\r\n' : '\n';
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(robots + (robots.endsWith('\n') ? '' : separator) + 'Sitemap: ' + sitemap + separator, {
    status: response.status, statusText: response.statusText, headers,
  });
}

export function publicDocumentResponse(release: Release, url: URL, metadata?: Map<string, PageMetadata>): Response | undefined {
  const indexableUrl = (entry: PublishedEntry) => {
    if (entry.visibility === 'private' || !entry.indexable) return null;
    const own = new URL(entry.path, release.settings.domain);
    const meta = metadata?.get(entry.id) ?? pageMetadata(entry, release, own);
    return meta.indexable && !/noindex/i.test(meta.robots) && meta.canonical === own.href ? own.href : null;
  };
  if(url.pathname===systemRoutes.searchIndex)
    return Response.json(release.entries.filter(entry=>entry.kind==='content'&&entry.visibility!=='private').map(entry=>({
      ...entry.fields,id:entry.id,title:entry.title,url:entry.path,description:entry.description,cover:entry.cover,
      category:entry.categories[0]??'',categoryName:release.settings.taxonomies.find(term=>term.id===entry.categories[0])?.label??entry.categories[0]??'',
      text:load(entry.html??'').text(),fields:entry.fields,
    })),{headers:{'Cache-Control':'no-cache'}});
  if(url.pathname===systemRoutes.videoSitemap) {
    const nodes=release.entries.filter(entry=>entry.visibility!=='private'&&entry.html?.includes('<video')).flatMap(entry=>{
      const loc = indexableUrl(entry);
      if (!loc) return [];
      const $=load(entry.html??'');return $('video[src]').toArray().map(video=>`<url><loc>${e(loc)}</loc><video:video><video:title>${e(entry.title)}</video:title><video:description>${e(entry.description||entry.title)}</video:description><video:thumbnail_loc>${e(new URL($(video).attr('poster')||entry.cover||'/og.png',release.settings.domain).href)}</video:thumbnail_loc><video:content_loc>${e(new URL($(video).attr('src')!,release.settings.domain).href)}</video:content_loc></video:video></url>`);
    });
    return new Response('<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'+nodes.join('')+'</urlset>',{headers:{'Content-Type':'application/xml'}});
  }
  if (url.pathname === systemRoutes.sitemap)
    return new Response(
      '<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        release.entries.flatMap(v => {
          const loc = indexableUrl(v);
          if (!loc) return [];
          const date = v.modifiedAt || v.updatedAt || v.publishedAt;
          return [`<url><loc>${e(loc)}</loc>${date ? `<lastmod>${e(date.slice(0, 10))}</lastmod>` : ''}</url>`];
        })
          .join('') +
        '</urlset>',
      { headers: { 'Content-Type': 'application/xml' } },
    );
  if (url.pathname === systemRoutes.robots)
    return new Response(
      `User-agent: *\nDisallow: /admin/\nDisallow: /__preview/\nSitemap: ${release.settings.domain.replace(/\/$/, '')}/sitemap.xml\n`,
      { headers: { 'Content-Type': 'text/plain' } },
    );
  if (url.pathname === systemRoutes.rss)
    return new Response(
      '<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>' +
        e(release.settings.name) +
        '</title><link>' +
        e(release.settings.domain) +
        '</link><description>' +
        e(release.settings.description) +
        '</description>' +
        scopedFeed(release, url.searchParams)
          .map((v) => {
            const date = v.publishedAt
              ? '<pubDate>' + new Date(v.publishedAt).toUTCString() + '</pubDate>'
              : '';
            const mode = !v.rssMode || v.rssMode === 'inherit' ? release.settings.rssMode ?? 'summary' : v.rssMode;
            let full = '';
            if (mode === 'full') {
              const body = load(sanitize(v.html), null, false);
              body('[href],[src],[poster]').each((_i, element) => { for (const attribute of ['href','src','poster']) { const value = body(element).attr(attribute); if (value) try { body(element).attr(attribute,new URL(value, release.settings.domain + v.path).href); } catch {} } });
              full = '<content:encoded>' + e(body.html()) + '</content:encoded>';
            }
            return `<item><title>${e(v.title)}</title><link>${e(new URL(v.path, release.settings.domain).href)}</link><guid isPermaLink="false">${e(v.id)}</guid><description>${e(v.description)}</description>${full}${date}</item>`;
          })
          .join('') +
        '</channel></rss>',
      { headers: { 'Content-Type': 'application/xml' } },
    );
}
