const panels = new Set(['content', 'pages', 'layouts', 'types', 'terms', 'media', 'comments', 'redirects', 'publication-plans', 'appearance', 'analytics', 'search-tools', 'operations', 'account']);
export function adminPanel(search: string) {
  const panel = new URLSearchParams(search).get('panel') ?? 'content';
  return panels.has(panel) ? panel : 'content';
}
export function panelUrl(href: string, panel: string) {
  const url = new URL(href);
  if (!panels.has(panel)) throw new Error('后台页面不存在。');
  if (panel === 'content') url.searchParams.delete('panel');
  else url.searchParams.set('panel', panel);
  return url.pathname + url.search + url.hash;
}
