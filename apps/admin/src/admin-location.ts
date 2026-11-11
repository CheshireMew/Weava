const panels = new Set(['content', 'notes', 'trash', 'media', 'comments', 'appearance', 'analytics', 'operations', 'account']);
export function adminPanel(search: string) {
  const panel = new URLSearchParams(search).get('panel') ?? 'content';
  if (panel === 'pages' || panel === 'layouts' || panel === 'terms') return 'appearance';
  return panels.has(panel) ? panel : 'content';
}
export function panelUrl(href: string, panel: string) {
  const url = new URL(href);
  if (!panels.has(panel)) throw new Error('后台页面不存在。');
  if(adminPanel(url.search)!==panel)url.searchParams.delete('entry');
  if (panel === 'content') url.searchParams.delete('panel');
  else url.searchParams.set('panel', panel);
  return url.pathname + url.search + url.hash;
}
export function entryUrl(href:string,id:string|null){
  const url=new URL(href,window.location.href);
  if(id)url.searchParams.set('entry',id);else url.searchParams.delete('entry');
  return url.pathname+url.search+url.hash;
}
export function recordEntryLocation(id:string|null){
  const next=entryUrl(window.location.href,id);
  if(next!==window.location.pathname+window.location.search+window.location.hash)window.history.pushState(null,'',next);
}
