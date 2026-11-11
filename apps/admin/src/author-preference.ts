const key = 'weava:last-author';
const historyKey = 'weava:recent-authors';

export function rememberedAuthors(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
    return [...new Set([recentAuthor(), ...(Array.isArray(stored) ? stored : [])].filter((name): name is string => typeof name === 'string' && !!name.trim()))];
  } catch { return recentAuthor() ? [recentAuthor()] : []; }
}

export function recentAuthor(): string {
  try { return localStorage.getItem(key) ?? ''; }
  catch { return ''; }
}

export function rememberAuthor(author: string): void {
  const name = author.trim();
  if (!name) return;
  try {
    const names = [name, ...rememberedAuthors().filter(item => item !== name)].slice(0, 20);
    localStorage.setItem(key, name);
    localStorage.setItem(historyKey, JSON.stringify(names));
  }
  catch { /* Editing remains available when browser storage is unavailable. */ }
}
