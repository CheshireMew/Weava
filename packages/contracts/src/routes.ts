export const systemRoutes = {
  rss: '/rss.xml',
  sitemap: '/sitemap.xml',
  robots: '/robots.txt',
  search: '/search/',
  searchIndex: '/search-index.json',
  videoSitemap: '/sitemap-videos.xml',
} as const;

export function isReservedContentPath(path: string) {
  return /^\/(admin|api|_astro|_admin|_site|media|site-assets|__preview|__health)(\/|$)/.test(path) ||
    Object.values(systemRoutes).some((value) => value === path);
}
