/** A site-owned extension: old URL compatibility follows the current public release. */
export const wordpressCompatibilityExtension = String.raw`
export default ({ queryEntries }) => ({
  id: 'wordpress-compat', apiVersion: 1, version: '1.3.0', label: 'WordPress 旧网址',
  async route(request, release) {
    if (!release) return null;
    const url = new URL(request.url);
    let path; try { path = decodeURI(url.pathname); } catch { return null; }
    const entries = release.entries.filter(entry => entry.visibility !== 'private');
    const root = entries.find(entry => entry.path === '/');
    const options = root?.source?.wordpressCompatibility;
    if (!options) return null;
    const move = (target, status = 301) => {
      const destination = new URL(target, release.settings.domain);
      return new Response(null, { status, headers: { Location: destination.pathname + destination.search, 'Cache-Control': 'no-cache' } });
    };
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const absolute = path => new URL(path, release.settings.domain).href;
    const originalRedirect = options.httpRedirects?.find(item => item.path === path);
    const current = entries.find(entry => entry.path === path);
    // An imported response alias must not redirect away from its own canonical page.
    const canonical = entry => absolute(entry.seo?.canonical || entry.path);
    const canonicalAlias = current && originalRedirect &&
      originalRedirect.target === current.source?.wordpressResponsePath && canonical(current) === absolute(current.path);
    if (originalRedirect && !canonicalAlias) return move(originalRedirect.target + (url.search ? (originalRedirect.target.includes('?') ? '&' : '?') + url.search.slice(1) : ''), originalRedirect.status);
    if (path === '/robots.txt' && options.robotsText !== undefined)
      return new Response(options.robotsText, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const xml = body => new Response('<?xml version="1.0" encoding="UTF-8"?>' + body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'X-Robots-Tag': 'noindex, follow' } });
    if (options.sitemapGroups) {
      if (path === '/wp-sitemap.xml') return move('/sitemap_index.xml');
      if (path === '/sitemap_index.xml') return xml('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        options.sitemapGroups.map(group => '<sitemap><loc>' + escape(absolute(group.path)) + '</loc></sitemap>').join('') + '</sitemapindex>');
      const group = options.sitemapGroups.find(group => group.path === path);
      if (group) {
        const selected = entries.filter(entry => entry.indexable !== false && canonical(entry) === absolute(entry.path) && (
          entry.source?.wordpressSitemapGroups?.includes(path) ||
          !entry.source?.wordpressSitemapGroups && (
            path === '/post-sitemap.xml' && entry.kind === 'content' && entry.type === 'post' ||
            path === '/page-sitemap.xml' && entry.kind === 'page')));
        return xml('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' +
          selected.map(entry => '<url><loc>' + escape(absolute(entry.path)) + '</loc>' +
            (entry.modifiedAt ? '<lastmod>' + escape(entry.modifiedAt) + '</lastmod>' : '') +
            (entry.kind === 'content' && entry.type === 'post' && (entry.source?.wordpressSitemapImage ?? entry.seo?.image ?? entry.cover) ? '<image:image><image:loc>' + escape(absolute(entry.source?.wordpressSitemapImage ?? entry.seo?.image ?? entry.cover)) + '</image:loc></image:image>' : '') + '</url>').join('') + '</urlset>');
      }
    }
    if (options.sitemaps.includes(path)) return move('/sitemap.xml');
    if (options.randomPaths.includes(path)) {
      const posts = entries.filter(entry => entry.kind === 'content' && entry.type === 'post');
      return posts.length ? move(posts[Math.floor(Math.random() * posts.length)].path, 302) : null;
    }
    if (path.endsWith('.html/') && entries.some(entry => entry.path === path.slice(0, -1))) {
      if (entries.some(entry => entry.source?.wordpressResponsePath === path && canonical(entry) === absolute(path))) return null;
      return move(path.slice(0, -1) + url.search);
    }
    const legacy = /^(.*\/)page\/(\d+)\/$/.exec(path);
    const base = legacy ? legacy[1] : path;
    const origin = entries.find(entry => entry.path === base);
    const archive = origin?.source?.wordpressArchive;
    if (!archive) return null;
    const values = url.searchParams.getAll('page');
    if (!legacy && !values.length) return null;
    const page = Number(legacy ? legacy[2] : values[0]);
    const invalid = !Number.isSafeInteger(page) || page < 1 || !legacy && (values.length !== 1 || !/^\d+$/.test(values[0]));
    if (invalid) return new Response('页面未找到', { status: 404, headers: { 'X-Robots-Tag': 'noindex,follow' } });
    const result = queryEntries(entries, { kind: 'content', type: archive.contentType, author: archive.author,
      category: archive.category, tag: archive.tag, pageSize: archive.pageSize, page }, release.types, release.terms);
    if (page > Math.max(1, result.pages)) return new Response('页面未找到', { status: 404, headers: { 'X-Robots-Tag': 'noindex,follow' } });
    if (!legacy || page === 1) {
      url.pathname = page > 1 ? base + 'page/' + page + '/' : base;
      url.searchParams.delete('page');
      return move(url.pathname + url.search);
    }
    return null;
  }
});
`;
