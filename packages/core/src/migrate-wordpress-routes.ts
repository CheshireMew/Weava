import {readFileSync,existsSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {load} from 'cheerio';
import {z,entrySchema,WeavaError,type Entry} from '@weava/contracts';
import {Site} from './site.ts';
import {withInstanceMaintenance} from './instance-access.ts';
import {normalizePath} from './paths.ts';
import {digest,now} from '../../runtime-common/src/identity.ts';
import {atomicJson} from '../../runtime-common/src/files.ts';
import {sourceContentHash} from './source-content.ts';
import {importedDocument} from './imported-document.ts';
import {wordpressCompatibilityExtension} from './wordpress-compat.ts';
import {bindBlockTerms} from './taxonomy.ts';

const archiveSchema = z.object({
  contentType: z.string().default('post'), category: z.string().optional(), tag: z.string().optional(),
  author: z.string().optional(), pageSize: z.number().int().min(1).max(100), targetPath: z.string().optional(),
  titleTemplate: z.string().optional(),
});
export const wordpressRoutesSchema = z.object({
  schema: z.literal('wordpress-routes-v1'), origin: z.url(), capturedAt: z.iso.datetime(),
  sitemaps: z.array(z.string()).default([]), randomPaths: z.array(z.string()).default([]),
  sitemapGroups: z.array(z.object({ path: z.string(), paths: z.array(z.string()) })).optional(),
  robotsText: z.string().optional(),
  httpRedirects: z.array(z.object({ path: z.string(), target: z.string(), status: z.union([z.literal(301), z.literal(302), z.literal(308)]) })).optional(),
  routes: z.array(z.object({
    path: z.string(), kind: z.enum(['article', 'page', 'moment', 'archive']), title: z.string(),
    sourceId: z.string().optional(), sourceType: z.string().optional(), author: z.string().optional(),
    publishedAt: z.iso.datetime().optional(), modifiedAt: z.iso.datetime().optional(),
    html: z.string().optional(), documentTitle: z.string(), description: z.string(), canonical: z.url(),
    robots: z.string().optional(), image: z.string().optional(), sitemapImage: z.string().optional(),
    canonicalPresent: z.boolean().optional(), responsePath: z.string().optional(),
    indexable: z.boolean(), archive: archiveSchema.optional(),
  })).min(1),
});

/** Supplements WordPress imports without replacing content the owner has edited. */
export async function migrateWordPressRoutes(input: string, target: string, dryRun = false) {
  const snapshot = wordpressRoutesSchema.parse(JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, '')));
  return withInstanceMaintenance(target, async () => {
    const site = new Site(target);
    try {
      const origin = new URL(snapshot.origin).origin;
      if (new URL(site.settings().value.domain).origin !== origin)
        throw new WeavaError('旧站域名与目标网站不一致，请先核对本站域名。');
      const rows = site.store.list('entry');
      const media = new Map(site.store.list('redirect').filter(row => row.id.startsWith('/wp-content/uploads/'))
        .map(row => [row.id, row.value.target as string]));
      const mediaManifest = join(target, 'imports', 'wordpress', 'media-url-map.json');
      if (existsSync(mediaManifest)) {
        const byHash = new Map(site.store.list('media').map(row => [row.value.hash, row.value.url as string]));
        for (const asset of JSON.parse(readFileSync(mediaManifest, 'utf8').replace(/^\uFEFF/, ''))) {
          const local = byHash.get(asset.sha256); if (!local) continue;
          for (const url of [asset.source_url, ...(asset.original_urls ?? [])]) if (url) media.set(url, local);
        }
      }
      const sourcePaths = new Set(snapshot.routes.map(route => normalizePath(route.path)));
      const rewrite = (html: string, path: string, preserveEmbeds = false) => {
        const $ = load(html, null, false);
        // Imported pages use native rendering; old theme scripts and forms are not executable content.
        $(preserveEmbeds ? 'script,style,form,object,embed' : 'script,style,form,iframe,object,embed').remove();
        $('img').each((_i, node) => {
          const image = $(node), original = image.attr('data-src') || image.attr('data-original') || image.attr('data-lazy-src');
          if (original) image.attr('src', original);
          image.removeAttr('data-src').removeAttr('data-original').removeAttr('data-lazy-src').removeAttr('data-srcset');
        });
        $('[href],[src],[poster],[srcset]').each((_i, node) => {
          for (const attribute of ['href', 'src', 'poster']) {
            const value = $(node).attr(attribute); if (!value) continue;
            if (media.has(value)) { $(node).attr(attribute, media.get(value)!); continue; }
            if (value === new URL(origin).host) { $(node).attr(attribute, '/'); continue; }
            try {
              const url = new URL(value, new URL(path, origin));
              let pathname = decodeURI(url.pathname);
              if (pathname.endsWith('.html/') && sourcePaths.has(pathname.slice(0, -1))) pathname = pathname.slice(0, -1);
              if (url.origin === origin) $(node).attr(attribute, media.get(normalizePath(pathname)) ?? pathname + url.search + url.hash);
            } catch {}
          }
          // The media renderer supplies new responsive sizes; old WP derivative lists are not needed.
          $(node).removeAttr('srcset').removeAttr('sizes');
        });
        return $.html();
      };
      const prepared: { entry: Entry; revision: number | null; marker: string; hash: string; changed: boolean }[] = [];
      const conflicts: { path: string; reason: string }[] = [];
      const seen = new Set<string>();
      for (const route of snapshot.routes) {
        const path = normalizePath(route.path);
        if (seen.has(path)) throw new WeavaError('来源网址重复：' + path); seen.add(path);
        const existing = rows.find(row => row.value.path === path);
        if (route.kind === 'article' && (!existing || existing.value.source?.system !== 'wordpress'))
          throw new WeavaError('请先迁移这篇 WordPress 文章：' + path);
        if (existing && existing.value.source?.system !== 'wordpress' && !existing.id.startsWith('wordpress:') && existing.id !== 'newsletter:archive')
          conflicts.push({ path, reason: '这个网址已由其他内容使用' });
        const marker = 'wordpress-route:' + path, mark = site.store.get('import', marker);
        if (mark && existing?.revision !== mark.value.targetRevision)
          conflicts.push({ path, reason: '上次迁移后目标内容已被编辑' });
        const id = existing?.id ?? 'wordpress:' + (route.sourceId ?? 'route:' + digest(path).slice(0, 20));
        let value: Entry = existing ? structuredClone(existing.value) : entrySchema.parse({
          id, kind: route.kind === 'moment' ? 'content' : 'page', type: route.kind === 'moment' ? 'wordpress-moment' : 'post',
          title: route.title || '无标题', path, status: 'published', author: route.author ?? '',
          publishedAt: route.publishedAt, createdAt: route.publishedAt, allowComments: false,
          document: { version: 1, format: 'html', source: rewrite(route.html ?? '', path) },
          blocks: route.kind === 'page' ? [{ id: 'page-heading', type: 'entry-heading', props: { cover: 'hide' } },
            { id: 'page-body', type: 'richtext', props: { text: rewrite(route.html ?? '', path) } }] : [],
          source: { system: 'wordpress', id: route.sourceId, originalType: route.sourceType,
            originalUrl: new URL(path, origin).href, modifiedAt: route.modifiedAt },
        });
        // Keep the owner's body, cover, layout and working state when enriching existing records.
        const beforeHash = sourceContentHash(value);
        let unchangedImport = !existing || !!mark && existing.value.source?.importedContentHash === beforeHash;
        if (existing) {
          const original = site.store.get('import', existing.id);
          const revision = original?.value.targetRevision;
          const historical = revision ? site.store.raw.prepare("SELECT data FROM revisions WHERE scope='entry' AND id=? AND revision=?").get(existing.id, revision) as { data: string } | undefined : undefined;
          unchangedImport ||= !!historical && beforeHash === sourceContentHash(entrySchema.parse(JSON.parse(historical.data)));
        }
        if ((route.kind === 'article' || route.kind === 'moment') && route.html !== undefined) {
          if (!unchangedImport) conflicts.push({ path, reason: '目标正文已被编辑，不能用旧站渲染结果替换' });
          else {
            value.document = importedDocument(rewrite(route.html, path, true));
            const originals: Record<string, string> = {}, $ = load(route.html, null, false);
            $('img').each((_i, node) => {
              const original = $(node).attr('data-src') || $(node).attr('data-original') || $(node).attr('data-lazy-src') || $(node).attr('src');
              if (!original) return;
              try {
                const url = new URL(original, new URL(path, origin));
                const local = media.get(original) ?? (url.origin === origin ? media.get(normalizePath(url.pathname)) : undefined);
                if (local) originals[local] = url.href;
              } catch {}
            });
            value.source = { ...value.source, renderedBodySha256: digest(route.html), wordpressMediaUrls: originals };
          }
        }
        if (existing && mark && route.kind === 'page' && route.html !== undefined) {
          const html = rewrite(route.html, path);
          value.title = route.title;
          value.document = { version: 1, format: 'html', source: html };
          value.blocks = [{ id: 'page-heading', type: 'entry-heading', props: { cover: 'hide' } }, { id: 'page-body', type: 'richtext', props: { text: html } }];
          delete value.source?.wordpressArchive;
        }
        value.seo = { ...value.seo, documentTitle: route.documentTitle, description: route.description, canonical: route.canonical, ...(route.image ? { image: route.image } : {}) };
        value.indexable = route.indexable && !snapshot.randomPaths.includes(path);
        value.source = { system: 'wordpress', modifiedAt: route.modifiedAt, ...value.source, wordpressRoute: path };
        if (route.robots !== undefined) value.source.wordpressSeo = { robots: route.robots, canonicalPresent: route.canonicalPresent };
        if (route.responsePath) value.source.wordpressResponsePath = route.responsePath;
        if (route.sitemapImage !== undefined) value.source.wordpressSitemapImage = route.sitemapImage;
        if (snapshot.sitemapGroups) value.source.wordpressSitemapGroups = snapshot.sitemapGroups.filter(group => group.paths.some(item => normalizePath(item) === path)).map(group => group.path);
        if (path === '/') value.source.wordpressCompatibility = { sitemaps: snapshot.sitemaps, randomPaths: snapshot.randomPaths, sitemapGroups: snapshot.sitemapGroups, robotsText: snapshot.robotsText, httpRedirects: snapshot.httpRedirects };
        if (route.archive) {
          value.source.wordpressArchive = route.archive;
          const { contentType, pageSize, targetPath: _target, titleTemplate: _title, ...filters } = route.archive;
          if (!route.archive.targetPath || route.archive.targetPath === path) {
            const lists = value.blocks.filter(block => ['content-list', 'cards'].includes(block.type));
            if (lists.length) {
              value.blocks = value.blocks.map(block => lists.includes(block) ? { ...block, props: { ...block.props, contentType, limit: pageSize, ...filters } } : block);
              if (!value.blocks.some(block => ['entry-heading', 'hero'].includes(block.type)))
                value.blocks.unshift({ id: 'archive-heading', type: 'entry-heading', props: { cover: 'hide' } });
            }
            else value.blocks = [{ id: 'archive-heading', type: 'entry-heading', props: { cover: 'hide' } },
              { id: 'archive-list', type: 'content-list', props: { contentType, limit: pageSize, ...filters } }];
          } else value.blocks = value.blocks.map(block => ['content-list', 'cards'].includes(block.type) ? { ...block, props: { ...block.props, limit: pageSize } } : block);
        }
        value.blocks = bindBlockTerms(value.blocks, site.terms().map(row => row.value));
        if (unchangedImport) value.source.importedContentHash = sourceContentHash(value);
        value = entrySchema.parse(value);
        const hash = digest(value);
        const current = existing ? entrySchema.parse(existing.value) : null;
        if (current) current.blocks = bindBlockTerms(current.blocks, site.terms().map(row => row.value));
        const changed = !current || !isDeepStrictEqual(JSON.parse(JSON.stringify(current)), JSON.parse(JSON.stringify(value)));
        prepared.push({ entry: value, revision: existing?.revision ?? null, marker, hash, changed });
      }
      const folder = join(target, 'extensions'), extensionPath = join(folder, 'wordpress-compat.mjs');
      const managedPreviousExtensions = ['4ca9de38f071b4bd069cd6eabd0d556a6bda7c650c5dc8ccef62d0fd0fec2af8', '6d31745b06e0dff1b1df2c376b5313b672d0d4a939ef95bea27d31ec8de026cf'];
      if (existsSync(extensionPath) && readFileSync(extensionPath, 'utf8') !== wordpressCompatibilityExtension && !managedPreviousExtensions.includes(digest(readFileSync(extensionPath))))
        conflicts.push({ path: 'extensions/wordpress-compat.mjs', reason: '兼容扩展已经被修改' });
      const manifestPath = join(folder, 'manifest.json');
      if (!existsSync(manifestPath) && existsSync(join(folder, 'index.mjs')))
        throw new WeavaError('请先将现有单文件扩展登记到扩展清单，再安装 WordPress 兼容扩展。');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, extensions: [] };
      const installed = manifest.extensions.find((item: any) => item.id === 'wordpress-compat');
      if (installed && (installed.file !== 'wordpress-compat.mjs' || !installed.enabled))
        conflicts.push({ path: 'extensions/manifest.json', reason: '现有兼容扩展的设置需要人工核对' });
      if (!installed) manifest.extensions.push({ id: 'wordpress-compat', file: 'wordpress-compat.mjs', enabled: true });
      const summary = { routes: prepared.length, added: prepared.filter(item => item.revision === null).length,
        updated: prepared.filter(item => item.revision !== null && item.changed).length,
        changes: prepared.filter(item => item.changed).map(item => ({ id: item.entry.id, path: item.entry.path })), conflicts, dryRun, published: false };
      if (dryRun) return summary;
      if (conflicts.length) throw new WeavaError('目标内容存在修改，未覆盖。', 409, conflicts);
      const archive = join(target, 'imports', 'wordpress-routes'); mkdirSync(archive, { recursive: true });
      const fingerprint = digest(readFileSync(input));
      const sourcePath = join(archive, fingerprint + '.json');
      if (!existsSync(sourcePath)) copyFileSync(input, sourcePath);
      const backup = join(archive, 'before-' + fingerprint.slice(0, 16) + '.sqlite');
      if (!existsSync(backup)) await site.store.raw.backup(backup);
      mkdirSync(folder, { recursive: true });
      if (!existsSync(extensionPath)) writeFileSync(extensionPath, wordpressCompatibilityExtension, { flag: 'wx' });
      else if (readFileSync(extensionPath, 'utf8') !== wordpressCompatibilityExtension) {
        const previous = join(archive, 'wordpress-compat-' + digest(readFileSync(extensionPath)) + '.mjs');
        if (!existsSync(previous)) copyFileSync(extensionPath, previous);
        writeFileSync(extensionPath, wordpressCompatibilityExtension);
      }
      if (!installed) atomicJson(manifestPath, manifest);
      const changedIds = prepared.filter(item => item.changed).map(item => item.entry.id);
      let published = false;
      site.store.raw.transaction(() => {
        if (prepared.some(item => item.entry.type === 'wordpress-moment') && !site.store.get('type', 'wordpress-moment'))
          site.saveType({ id: 'wordpress-moment', label: '笔记', pathPrefix: '/moments/', template: 'article', fields: [] }, null);
        for (const item of prepared) {
          const saved = item.changed ? site.saveEntry(item.entry, item.revision) : site.store.get('entry', item.entry.id)!;
          const marker = site.store.get('import', item.marker);
          const value = { hash: item.hash, targetRevision: saved.revision, fingerprint };
          if (!marker || digest(marker.value) !== digest(value)) site.store.put('import', item.marker, value, marker?.revision ?? null);
        }
        const publicRelease = site.release();
        const aliases = Object.fromEntries(site.store.list('redirect').map(row => [row.id, row.value]));
        const routesChanged = Object.entries(aliases).some(([key, value]) => digest(publicRelease?.redirects?.[key] ?? null) !== digest(value));
        if (changedIds.length) { site.publish({ scope: 'entries', ids: changedIds, label: '补齐 WordPress 页面与 SEO' }); published = true; }
        if (routesChanged || !publicRelease) { site.publish({ scope: 'routes', label: '接续 WordPress 旧链接' }); published = true; }
      }).immediate();
      const result = { ...summary, published, changedIds, releaseId: site.release()?.id, sourcePath, backup, completedAt: now() };
      atomicJson(join(archive, 'report.json'), result);
      return result;
    } finally { site.close(); }
  });
}
