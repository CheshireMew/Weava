import type { Entry, Term } from '@weava/contracts';

export const englishSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
export const normalizeSlug = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

export function sanitizeEnglishTitle(value: string) {
  return normalizeSlug(value.normalize('NFKD').replace(/\p{M}/gu, ''))
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function entryUrlParts(path: string, id: string) {
  const parts = path.split('/').filter(Boolean);
  const slug = parts.pop() || id.slice(0, 8);
  return { prefix: '/' + (parts.length ? parts.join('/') + '/' : ''), slug };
}

export function categoryPath(entry: Pick<Entry, 'id' | 'path'>, categories: Term[], fallback = '/posts/') {
  const first = categories[0];
  if (first && !englishSlug(first.slug)) throw new Error(`请先为“${first.label}”填写英文别名。`);
  const prefix = first ? '/' + first.slug.toLowerCase() + '/' : fallback.replace(/\/?$/, '/');
  const {slug} = entryUrlParts(entry.path, entry.id);
  return prefix + (englishSlug(slug) ? slug.toLowerCase() : entry.id.slice(0, 8)) + '/';
}
