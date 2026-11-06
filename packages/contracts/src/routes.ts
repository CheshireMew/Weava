export const systemRoutes = {
  rss: '/rss.xml',
  sitemap: '/sitemap.xml',
  robots: '/robots.txt',
  search: '/search/',
} as const;

export function isReservedContentPath(path: string) {
  return /^\/(admin|api|_astro|_admin|_site|media|__preview|__health)(\/|$)/.test(path) ||
    Object.values(systemRoutes).some((value) => value === path);
}
