import { Site, walk, digest, normalizePath, renderDocument } from '@weava/core';
import { load } from 'cheerio';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = 'E:/Code/WeavaSites/crypto-blacknico',
  capture = 'D:/Tools/cache/weava/crypto-capture';
const reportRoot = 'D:/Tools/cache/weava/acceptance';
mkdirSync(reportRoot, { recursive: true });
const site = new Site(root),
  release = site.release()!;
const paths = new Set(release.entries.map((e) => e.path));
const assets = new Set(
  walk(join(root, 'media')).map(
    (f) => '/media/' + relative(join(root, 'media'), f).replaceAll('\\', '/'),
  ),
);
const themeAssets = new Set(
  walk(join(root, 'themes/crypto')).map(
    (f) => '/' + relative(join(root, 'themes/crypto'), f).replaceAll('\\', '/'),
  ),
);
const failures: any[] = [];
const anchorFailures: any[] = [];
const checked = new Map<string, Set<string>>();
for (const entry of release.entries) {
  const html = entry.compatibility?.main ?? entry.html;
  const $ = load(html);
  const ids = new Set(
    $('[id]')
      .toArray()
      .map((el) => $(el).attr('id')!),
  );
  const rendered = load(renderDocument(entry.document));
  rendered('[id]').each((_i, el) => {
    ids.add(rendered(el).attr('id')!);
  });
  checked.set(entry.path, ids);
}
let references = 0;
for (const entry of release.entries) {
  const $ = load(entry.compatibility?.main ?? entry.html);
  $('[href],[src],[poster]').each((_i, el) => {
    const node = $(el),
      raw = node.attr('href') ?? node.attr('src') ?? node.attr('poster') ?? '';
    if (!raw || raw.startsWith('data:') || raw.startsWith('mailto:') || raw.startsWith('tel:'))
      return;
    let u: URL;
    try {
      u = new URL(raw, 'https://crypto.blacknico.com' + entry.path);
    } catch {
      return;
    }
    if (u.hostname !== 'crypto.blacknico.com') return;
    references++;
    let path: string;
    try {
      path = normalizePath(u.pathname);
    } catch {
      failures.push({ entry: entry.path, url: raw });
      return;
    }
    const decoded = decodeURIComponent(u.pathname);
    if (
      !paths.has(path) &&
      !assets.has(decoded) &&
      !themeAssets.has(decoded) &&
      !/^\/(video|api|admin|search)(\/|$)/.test(path) &&
      !['/rss.xml', '/sitemap.xml', '/robots.txt'].includes(path)
    )
      failures.push({ entry: entry.path, url: raw, path });
    if (u.hash && paths.has(path) && !checked.get(path)?.has(decodeURIComponent(u.hash.slice(1))))
      anchorFailures.push({ entry: entry.path, url: raw });
  });
}
const baseline = JSON.parse(readFileSync(join(capture, 'source-baseline.json'), 'utf8'));
const sourceChanged = baseline.filter(
  (item: any) => !existsSync(item.path) || digest(readFileSync(item.path)) !== item.hash,
);
const sourceUrls = walk(join(capture, 'site'))
  .filter((f) => f.endsWith('index.html'))
  .map(
    (f) =>
      '/' +
      relative(join(capture, 'site'), f)
        .replaceAll('\\', '/')
        .replace(/index.html$/, ''),
  );
const missingUrls = sourceUrls.filter((path) => !paths.has(path));
const result = {
  releaseId: release.id,
  pages: paths.size,
  sourcePages: sourceUrls.length,
  references,
  missingUrls,
  missingReferences: failures,
  anchorFailures,
  sourceFiles: baseline.length,
  sourceChanged,
  compatibility: release.entries.filter((e) => e.compatibility).length,
  archived: site.entries().filter((e) => e.value.status === 'archived').length,
};
writeFileSync(join(reportRoot, 'migration.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    ...result,
    missingReferences: failures.slice(0, 10),
    anchorFailures: anchorFailures.slice(0, 10),
  }),
);
site.close();
if (missingUrls.length || failures.length || sourceChanged.length || anchorFailures.length)
  process.exitCode = 1;
