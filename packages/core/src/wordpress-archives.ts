import type { Entry, Release, PublishedEntry } from '@weava/contracts';
import { publishedResponsePath } from './release-reader.ts';
import { releaseIndex } from './release-index.ts';

const responsePaths=new WeakMap<Release,Map<string,PublishedEntry>>();

export function wordpressPagePath(base: string, page: number) {
  return page > 1 ? base.replace(/\/?$/, '/') + 'page/' + page + '/' : base;
}

export function wordpressArchivePage(entry: Entry | undefined, url: URL) {
  if (!entry?.source?.wordpressArchive) return null;
  let path: string; try { path = decodeURI(url.pathname); } catch { return null; }
  const match = /^(.*\/)page\/([1-9]\d*)\/$/.exec(path);
  if (match?.[1] === entry.path) return Number(match[2]);
  // A numbered pathname takes precedence; a query page is handled by the list
  // renderer (older compatibility extensions still use ?page= links).
  return path === entry.path && !url.searchParams.has('page') ? 1 : null;
}

/** Resolve old numbered pages to the current archive without changing the public URL. */
export function wordpressArchiveEntry(release: Release, url: URL): PublishedEntry | undefined {
  let path: string; try { path = decodeURI(url.pathname); } catch { return; }
  let aliases=responsePaths.get(release);
  if(!aliases){
    aliases=new Map();
    for(const entry of release.entries){
      if(entry.visibility==='private')continue;
      const alternate=publishedResponsePath(entry);
      if(alternate&&!aliases.has(alternate))aliases.set(alternate,entry);
    }
    responsePaths.set(release,aliases);
  }
  const alternate = aliases.get(path);
  if (alternate) return alternate;
  const match = /^(.*\/)page\/([1-9]\d*)\/$/.exec(path);
  if (!match || Number(match[2]) < 2) return;
  const entry = releaseIndex(release).byPath.get(match[1]);
  if (!entry || entry.visibility === 'private' || !entry.source?.wordpressArchive) return;
  if (entry.template === 'newsletter-home') {
    // The publication homepage no longer needs a generic list block. Numbered
    // WordPress URLs still need their original filters and page size.
    const archive = entry.source!.wordpressArchive;
    return { ...entry, template: 'newsletter-archive', blocks: [{
      id: 'wordpress-archive-list', type: 'content-list', props: {
        contentType: archive.contentType, category: archive.category, tag: archive.tag,
        author: archive.author, limit: archive.pageSize,
      },
    }] };
  }
  return { ...entry, template: 'page' };
}
