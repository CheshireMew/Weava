const key = 'weava:last-author';

export function recentAuthor(): string {
  try { return localStorage.getItem(key) ?? ''; }
  catch { return ''; }
}

export function rememberAuthor(author: string): void {
  try { localStorage.setItem(key, author.trim()); }
  catch { /* Editing remains available when browser storage is unavailable. */ }
}
