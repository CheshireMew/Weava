import type { Release } from '@weava/contracts';
import { systemRoutes } from '@weava/contracts';
import { escape as e, scopedFeed } from '@weava/core';
import { load } from 'cheerio';
export function publicDocumentResponse(release: Release, url: URL): Response | undefined {
  if(url.pathname===systemRoutes.searchIndex)
    return Response.json(release.entries.filter(entry=>entry.kind==='content'&&entry.visibility!=='private').map(entry=>({
      ...entry.fields,id:entry.id,title:entry.title,url:entry.path,description:entry.description,cover:entry.cover,
      category:entry.categories[0]??'',categoryName:release.settings.taxonomies.find(term=>term.id===entry.categories[0])?.label??entry.categories[0]??'',
      text:load(entry.html??'').text(),fields:entry.fields,
    })),{headers:{'Cache-Control':'no-cache'}});
  if(url.pathname===systemRoutes.videoSitemap) {
    const nodes=release.entries.filter(entry=>entry.indexable&&entry.visibility!=='private').flatMap(entry=>{
      const $=load(entry.html??'');return $('video[src]').toArray().map(video=>`<url><loc>${e(new URL(entry.path,release.settings.domain).href)}</loc><video:video><video:title>${e(entry.title)}</video:title><video:description>${e(entry.description||entry.title)}</video:description><video:thumbnail_loc>${e(new URL($(video).attr('poster')||entry.cover||'/og.png',release.settings.domain).href)}</video:thumbnail_loc><video:content_loc>${e(new URL($(video).attr('src')!,release.settings.domain).href)}</video:content_loc></video:video></url>`);
    });
    return new Response('<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'+nodes.join('')+'</urlset>',{headers:{'Content-Type':'application/xml'}});
  }
  if (url.pathname === systemRoutes.sitemap)
    return new Response(
      '<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        release.entries
          .filter((v) => v.indexable)
          .map(
            (v) =>
              `<url><loc>${e(release.settings.domain.replace(/\/$/, '') + v.path)}</loc><lastmod>${v.modifiedAt?.slice(0, 10) ?? release.createdAt.slice(0, 10)}</lastmod></url>`,
          )
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
      '<?xml version="1.0"?><rss version="2.0"><channel><title>' +
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
            return `<item><title>${e(v.title)}</title><link>${e(release.settings.domain + v.path)}</link><guid isPermaLink="false">${e(v.id)}</guid><description>${e(v.description)}</description>${date}</item>`;
          })
          .join('') +
        '</channel></rss>',
      { headers: { 'Content-Type': 'application/xml' } },
    );
}
