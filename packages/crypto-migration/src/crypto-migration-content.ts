import { entrySchema } from '@weava/contracts';
import { load } from 'cheerio';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { digest } from '../../runtime-common/src/identity.ts';
import type { CryptoEntryWriter } from './crypto-migration-records.ts';
import { markdown, type CryptoMigrationSource } from './crypto-migration-source.ts';
import type { Site } from '../../core/src/site.ts';
export function importCryptoPublicContent(
  input: CryptoMigrationSource,
  put: CryptoEntryWriter,
  compatibility: { id: string; path: string; mode: string }[],
) {
  const { htmlFiles, publicRoot, pages, originals, seo, source } = input;
  for (const file of htmlFiles) {
    const path =
      '/' +
      relative(publicRoot, file)
        .replaceAll('\\', '/')
        .replace(/index\.html$/, '');
    const raw = readFileSync(file, 'utf8'),
      $ = load(raw);
    const info = pages.get(path);
    const original = originals.get(path);
    const id = original?.id ?? info?.id ?? 'page:' + path;
    const isContent = !!info && path !== '/library/launch-station/';
    const article = $('article.article-body').first();
    let sourceBody = article.length ? (article.html() ?? '') : ($('main').html() ?? '');
    const head = $('head').html() ?? '';
    const shell = raw
      .replace(/<head[^>]*>[\s\S]*?<\/head>/i, '<head>__WEAVA_HEAD__</head>')
      .replace(/<main\b[^>]*>[\s\S]*?<\/main>/i, '<main id="main">__WEAVA_MAIN__</main>');
    const main = $('main').html() ?? '';
    const metadata = seo[path] ?? {};
    const value = entrySchema.parse({
      id,
      kind: isContent ? 'content' : 'page',
      type: original ? 'post' : 'source',
      title: original?.title ?? info?.title ?? $('h1').first().text() ?? path,
      path,
      description:
        original?.description ??
        info?.description ??
        $('meta[name=description]').attr('content') ??
        '',
      author: original?.author ?? 'BlackNico',
      cover: original?.cover ?? info?.cover ?? '',
      categories: [original?.category ?? info?.category].filter(Boolean),
      fields: info
        ? {
            platform: info.platform,
            service: info.service,
            kind: info.kind,
            readMinutes: info.readMinutes,
          }
        : {},
      status: 'published',
      indexable: $('meta[name=robots]').attr('content')?.includes('noindex') ? false : true,
      createdAt: original?.created_at ?? metadata.published,
      publishedAt:
        original?.published_at ??
        (metadata.published ? metadata.published + 'T00:00:00+08:00' : undefined),
      document: original
        ? { version: 1, format: 'markdown', source: original.markdown }
        : { version: 1, format: 'html', source: sourceBody },
      compatibility: {
        head,
        shell,
        main,
        article: !!article.length,
        initialTitle: original?.title ?? info?.title ?? $('h1').first().text(),
        initialDescription: original?.description ?? info?.description ?? '',
        initialBody: sourceBody,
      },
      source: { path: file, url: info?.source ?? '', provider: info?.platform ?? 'site' },
    });
    if (original) {
      const publishedFile = join(source, 'content/published', original.slug + '.md');
      if (existsSync(publishedFile)) {
        const published = markdown(publishedFile);
        value.document = { version: 1, format: 'markdown', source: published.markdown };
      }
    }
    if (!isContent)
      value.blocks = [{ id: 'legacy-layout', type: 'compatibility', props: { html: main } }];
    put(value, digest('converter-v2' + raw + JSON.stringify(original ?? {})));
    if (!original)
      compatibility.push({
        id,
        path,
        mode: isContent ? 'editable-source-html' : 'preserved-page-layout',
      });
  }
}
export function restoreCryptoDrafts(
  site: Site,
  input: CryptoMigrationSource,
  put: CryptoEntryWriter,
) {
  const { originals } = input;
  for (const [path, post] of originals) {
    const existing = site.store.get('entry', post.id);
    if (existing) {
      const live = existing.value;
      const sourceDoc = {
        version: 1 as const,
        format: 'markdown' as const,
        source: post.markdown,
      };
      if (digest(live.document) !== digest(sourceDoc))
        site.saveEntry(
          {
            ...live,
            document: sourceDoc,
            title: post.title,
            description: post.description,
            status: post.status ?? 'draft',
          },
          existing.revision,
        );
      const mark = site.store.get('import', post.id);
      if (mark)
        site.store.put(
          'import',
          post.id,
          { ...mark.value, targetRevision: site.store.get('entry', post.id)!.revision },
          mark.revision,
        );
    } else {
      put(
        entrySchema.parse({
          id: post.id,
          kind: 'content',
          type: 'post',
          title: post.title,
          path,
          description: post.description,
          author: post.author,
          categories: [post.category],
          cover: post.cover,
          status: post.status === 'archived' ? 'archived' : 'draft',
          document: sourceDoc(post.markdown),
          createdAt: post.created_at,
        }),
        digest(post),
      );
    }
  }
  function sourceDoc(text: string) {
    return { version: 1 as const, format: 'markdown' as const, source: text };
  }
}
export function importCryptoHiddenContent(site: Site, input: CryptoMigrationSource) {
  const { catalog } = input;
  let hiddenCount = 0;
  for (const sourcePage of catalog.basePages ?? []) {
    if (!catalog.hidden.includes(sourcePage.url) || site.store.get('entry', sourcePage.id))
      continue;
    site.saveEntry(
      entrySchema.parse({
        id: sourcePage.id,
        kind: 'content',
        type: 'source',
        path: sourcePage.url,
        title: sourcePage.title,
        description: sourcePage.description,
        status: 'archived',
        document: { version: 1, format: 'markdown', source: sourcePage.text ?? '' },
        categories: [sourcePage.category].filter(Boolean),
        source: { hidden: true, provider: sourcePage.platform, url: sourcePage.source },
      }),
      null,
    );
    hiddenCount++;
  }
}
