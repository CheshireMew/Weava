import type { Entry, Release } from '@weava/contracts';
import { mediaIdentity } from './paths.ts';
import { referencedLayouts } from './layouts.ts';

/** One file identity for authored URLs, rendered HTML, history and usage reports. */
export function mediaReferencesIn(value: unknown): Set<string> {
  const paths = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\/media\/[^"'<>\\\s)\]}]+/gi)) {
        const path = match[0].split(/[?#]/)[0];
        try {
          paths.add(mediaIdentity(path));
        } catch {
          /* Invalid addresses cannot identify a served file. */
        }
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return paths;
}

export function entryMediaReferences(
  entry: Entry,
  catalog?: Pick<Release, 'settings' | 'types' | 'layouts'>,
) {
  return mediaReferencesIn([
    entry.cover,
    entry.blocks?.length ? null : entry.document,
    entry.blocks,
    entry.fields,
    catalog ? referencedLayouts(entry, catalog) : [],
  ]);
}
