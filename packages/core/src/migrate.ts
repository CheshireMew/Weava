import { join, relative, resolve, extname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parse as yaml } from 'yaml';
import { build } from 'esbuild';
import Database from 'better-sqlite3';
import { Site } from './site.ts';
import { walk, digest, atomicJson, now } from './storage.ts';
import {
  entrySchema,
  defaultSettings,
  type Entry,
  type Settings,
  WeavaError,
} from '@weava/contracts';
import { Analytics } from './analytics.ts';
function read(path: string, fallback: any = null) {
  return existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/, ''))
    : fallback;
}
function markdown(file: string) {
  const raw = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new WeavaError('Markdown 元信息无效：' + file);
  return { ...yaml(match[1]), markdown: match[2] };
}
export async function migrateCrypto(
  source: string,
  target: string,
  capture: string,
  dryRun = false,
) {
  const publicRoot = join(capture, 'site');
  if (!existsSync(publicRoot)) throw new WeavaError('找不到参考网站，请先运行 capture-crypto。');
  const sourceBaseline = read(join(capture, 'source-baseline.json'), []) as {
    path: string;
    hash: string;
  }[];
  const sourceChanged = sourceBaseline
    .filter((item) => !existsSync(item.path) || digest(readFileSync(item.path)) !== item.hash)
    .map((item) => item.path);
  if (sourceChanged.length && !dryRun)
    throw new WeavaError('来源已变化，请重新生成隔离参考快照。', 409, sourceChanged);
  const catalog = read(join(capture, 'catalog.json'), { pages: [], categories: [], hidden: [] });
  const pages = new Map<string, any>(catalog.pages.map((p: any) => [p.url, p]));
  const config = read(join(source, 'site.config.json'));
  const seo = read(
    join(capture, 'seo-history.json'),
    read(join(source, 'content/seo-history.json'), {}),
  );
  const htmlFiles = walk(publicRoot).filter((f) => f.endsWith('index.html'));
  const originals = new Map<string, any>();
  for (const file of walk(join(source, 'content/posts')).filter((f) => f.endsWith('.md'))) {
    const post = markdown(file);
    originals.set('/guides/' + post.slug + '/', post);
  }
  const plan = {
    source,
    target,
    capture,
    pages: htmlFiles.length,
    content: catalog.pages.length,
    originals: originals.size,
    hidden: catalog.hidden.length,
    sourceChanged,
  };
  if (dryRun) return { ...plan, dryRun: true };
  const site = new Site(target);
  const imported: any[] = [],
    conflicts: any[] = [],
    compatibility: any[] = [];
  mkdirSync(join(target, 'imports'), { recursive: true });
  try {
    for (const [id, label, prefix] of [
      ['post', '原创文章', '/guides/'],
      ['source', '来源资料', '/learn/'],
    ])
      if (!site.store.get('type', id))
        site.saveType({ id, label, pathPrefix: prefix, template: 'article', fields: [] }, null);
    const nav = load(readFileSync(join(publicRoot, 'index.html'), 'utf8'))('nav#main-nav a')
      .toArray()
      .map((a) => ({ label: load(a).text(), url: load(a)('a').attr('href') ?? '/' }));
    const settings: Settings = {
      ...defaultSettings,
      name: config.name,
      domain: config.domain,
      language: config.language,
      theme: 'crypto-blacknico',
      themeConfig: {
        ...defaultSettings.themeConfig,
        accent: '#536940',
        background: '#f6f8f3',
        width: 1280,
      },
      navigation: nav,
      description: '加密学习资料与原创指南',
      taxonomies: catalog.categories.map((c: any) => ({
        id: c.slug,
        label: c.name,
        description: c.description,
      })),
      extensions: { crypto: { config } },
      footer: '© BlackNico · 独立学习资料站',
    };
    const settingsMark = site.store.get('import', 'settings');
    if (!settingsMark || site.settings().revision === settingsMark.value.targetRevision) {
      const saved = site.saveSettings(settings, site.settings().revision);
      site.store.put(
        'import',
        'settings',
        { targetRevision: saved.revision },
        settingsMark?.revision ?? null,
      );
    } else conflicts.push({ id: 'settings', reason: '目标设置已被编辑' });
    const put = (value: Entry, sourceHash: string) => {
      const marker = site.store.get('import', value.id),
        existing = site.store.get('entry', value.id);
      if (existing && marker?.value.targetRevision !== existing.revision) {
        conflicts.push({ id: value.id, path: value.path, reason: '目标已被编辑' });
        return;
      }
      if (marker?.value.hash === sourceHash) {
        imported.push({ id: value.id, unchanged: true, path: value.path });
        return;
      }
      const saved = site.saveEntry(value, existing?.revision ?? null);
      site.store.put(
        'import',
        value.id,
        { hash: sourceHash, targetRevision: saved.revision },
        marker?.revision ?? null,
      );
      imported.push({ id: value.id, path: value.path, revision: saved.revision });
    };
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
    // Public and unpublished media must exist before publication validation.
    for (const file of walk(join(source, 'public/media')).filter(
      (f) => !/\.(mp4|m4v|mov|webm)$/i.test(f),
    )) {
      const destination = join(target, 'media', relative(join(source, 'public/media'), file));
      mkdirSync(resolve(destination, '..'), { recursive: true });
      if (!existsSync(destination)) copyFileSync(file, destination);
    }
    for (const file of walk(join(publicRoot, 'media'))) {
      const destination = join(target, 'media', relative(join(publicRoot, 'media'), file));
      mkdirSync(resolve(destination, '..'), { recursive: true });
      if (!existsSync(destination)) copyFileSync(file, destination);
    }
    // Publish exactly the source public state, then restore independent authoring drafts.
    if (conflicts.length) throw new WeavaError('目标存在修改，迁移停止发布。', 409, conflicts);
    if (imported.some((i) => !i.unchanged)) site.publish({ label: '从加密网站迁移公开版本' });
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
    // Copy actual runtime assets. Videos remain remote references; no hard links to the source.
    for (const file of walk(publicRoot).filter(
      (f) => !f.endsWith('index.html') && !/\.(mp4|m4v|mov|webm)$/i.test(f),
    )) {
      const relativePath = relative(publicRoot, file);
      const destination = relativePath.startsWith('media')
        ? join(target, relativePath)
        : join(target, 'themes/crypto', relativePath);
      mkdirSync(resolve(destination, '..'), { recursive: true });
      if (
        !existsSync(destination) ||
        digest(readFileSync(destination)) !== digest(readFileSync(file))
      )
        copyFileSync(file, destination);
    }
    for (const file of walk(join(source, 'public/media')).filter(
      (f) => !/\.(mp4|m4v|mov|webm)$/i.test(f),
    )) {
      const destination = join(target, 'media', relative(join(source, 'public/media'), file));
      mkdirSync(resolve(destination, '..'), { recursive: true });
      if (!existsSync(destination)) copyFileSync(file, destination);
    }
    const archiveFiles = [
      ...walk(join(source, 'content')),
      ...walk(join(source, '.cms/versions')),
      ...walk(join(source, '.cms/management')),
    ].filter((f) => !f.endsWith('.pyc'));
    for (const file of archiveFiles) {
      const destination = join(target, 'imports/legacy', relative(source, file));
      mkdirSync(resolve(destination, '..'), { recursive: true });
      if (!existsSync(destination)) copyFileSync(file, destination);
    }
    // Import authoring histories as native read-only revisions, retaining originals too.
    let historyCount = 0;
    for (const file of walk(join(source, '.cms/versions')).filter((f) => f.endsWith('.json'))) {
      const item = read(file);
      if (!item?.markdown) continue;
      try {
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(item.markdown);
        if (!match) continue;
        const meta = yaml(match[1]),
          entry = site.store.get('entry', meta.id);
        if (!entry) continue;
        const mark = 'history:' + digest(file);
        if (site.store.get('import', mark)) continue;
        const v = {
          ...entry.value,
          title: meta.title,
          description: meta.description,
          document: sourceDoc(match[2]),
        };
        site.store.raw
          .prepare('INSERT INTO revisions(scope,id,data,created_at,label) VALUES(?,?,?,?,?)')
          .run(
            'entry',
            meta.id,
            JSON.stringify(v),
            item.created ?? now(),
            '迁移历史：' + (item.label ?? ''),
          );
        site.store.put('import', mark, { source: file }, null);
        historyCount++;
      } catch (error) {
        conflicts.push({ file, error: String(error) });
      }
    }
    const analytics = new Analytics(target);
    try {
      for (const file of walk(join(source, '.cms/analytics')).filter((f) =>
        /\.(sqlite3|sqlite|db)$/.test(f),
      )) {
        const dest = join(target, 'imports', 'statistics-' + digest(file).slice(0, 12) + '.sqlite');
        if (!existsSync(dest)) {
          const db = new Database(file, { readonly: true });
          try {
            await db.backup(dest);
          } finally {
            db.close();
          }
        }
        analytics.raw
          .prepare('INSERT OR REPLACE INTO legacy_sources VALUES(?,?,?)')
          .run(digest(file), dest, JSON.stringify({ source: file }));
        const old = new Database(dest, { readonly: true });
        try {
          const insert = analytics.raw.prepare(
              'INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            ),
            sourceId = 'legacy:' + digest(file).slice(0, 12) + ':';
          analytics.raw.transaction(() => {
            for (const row of old.prepare('SELECT * FROM views').all() as any[])
              insert.run(
                sourceId + row.id,
                'view',
                new Date(row.ts).toISOString(),
                row.path,
                row.visitor,
                row.session,
                '',
                '',
                '',
                row.referrer ?? '',
                'legacy',
              );
            for (const row of old
              .prepare('SELECT c.*,v.visitor FROM clicks c LEFT JOIN views v ON v.id=c.view_id')
              .all() as any[])
              insert.run(
                sourceId + row.id,
                'click',
                new Date(row.ts).toISOString(),
                row.path,
                row.visitor ?? '',
                row.session ?? '',
                row.url,
                row.label,
                row.zone,
                '',
                'legacy',
              );
          })();
        } finally {
          old.close();
        }
      }
    } finally {
      analytics.close();
    }
    for (const name of [
      'video-sources.json',
      'exchange-announcements.json',
      'equity-catalog.json',
      'link-overrides.json',
    ]) {
      const file = join(source, 'content', name);
      if (existsSync(file)) copyFileSync(file, join(target, 'imports', name));
    }
    if (existsSync(join(capture, 'equity-rules.json')))
      copyFileSync(join(capture, 'equity-rules.json'), join(target, 'imports/equity-rules.json'));
    copyFileSync(
      join(publicRoot, 'equity-catalog.json'),
      join(target, 'imports/public-stock-snapshot.json'),
    );
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
    // Register migrated attachments without regenerating already prepared derivatives.
    const mediaMetadata = read(join(source, 'content/media-metadata.json'), { images: {} });
    for (const file of walk(join(target, 'media')).filter(
      (f) => relative(join(target, 'media'), f).split(/[\\/]/).length === 1,
    )) {
      const id = digest(relative(join(target, 'media'), file)).slice(0, 24);
      if (site.store.get('media', id)) continue;
      const data = readFileSync(file),
        name = relative(join(target, 'media'), file),
        metadata = mediaMetadata.images?.[name] ?? {};
      site.store.put(
        'media',
        id,
        {
          id,
          name,
          url: '/media/' + encodeURIComponent(name),
          bytes: data.length,
          hash: digest(data),
          ...metadata,
          imported: true,
        },
        null,
        '迁移媒体',
      );
    }
    const framework = process.env.WEAVA_FRAMEWORK ?? resolve(import.meta.dirname, '../../..');
    const extensionTemplate = join(framework, 'scripts/crypto-extension.ts');
    const extensionTarget = join(target, 'extensions/index.ts');
    if (!existsSync(extensionTarget)) copyFileSync(extensionTemplate, extensionTarget);
    await build({
      entryPoints: [extensionTarget],
      outfile: join(target, 'extensions/index.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      banner: {
        js: 'import { createRequire as _createRequire } from \"node:module\"; const require = _createRequire(import.meta.url);',
      },
      nodePaths: [join(framework, 'node_modules')],
    });
    atomicJson(join(target, 'site.json'), { version: 1, port: 4323 });
    const report = {
      ...plan,
      imported,
      compatibility,
      conflicts,
      historyCount,
      completedAt: now(),
      sourceUnchanged: true,
    };
    atomicJson(join(target, 'imports/migration-report.json'), report);
    return {
      ...plan,
      imported: imported.length,
      compatibility: compatibility.length,
      historyCount,
      conflicts,
    };
  } finally {
    site.close();
  }
}
