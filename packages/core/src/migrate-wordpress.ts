import { join, extname } from 'node:path';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { load } from 'cheerio';
import { entrySchema, defaultSettings, WeavaError, type Entry, type Settings } from '@weava/contracts';
import { Site, normalizePath } from './site.ts';
import { inside, digest, atomicJson, now } from './storage.ts';
import { renderDocument, plain } from './documents.ts';
import { uploadMedia } from './media.ts';
import { Analytics } from './analytics.ts';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/, ''));

export async function migrateWordPressViews(input: string, target: string) {
  const snapshot = read(input);
  if (snapshot.schema !== 'wordpress-view-totals-v1' || !Array.isArray(snapshot.entries))
    throw new WeavaError('不支持这个 WordPress 浏览量导出格式。');
  if (!existsSync(join(target, 'weava.sqlite'))) throw new WeavaError('请先迁移 WordPress 文章。');
  const site = new Site(target), analytics = new Analytics(target);
  try {
    const missing: string[] = [];
    const entries = snapshot.entries.map((item: any) => {
      const record = site.store.get('entry', 'wordpress:' + item.postId);
      if (!record || record.value.source?.system !== 'wordpress' || String(record.value.source.id) !== String(item.postId))
        missing.push(String(item.postId));
      return { entryId: record?.id, path: record?.value.path, views: item.views };
    });
    if (missing.length) throw new WeavaError('浏览量中有尚未迁移的文章。', 400, missing);
    const archive = join(target, 'imports', 'wordpress');
    mkdirSync(archive, { recursive: true });
    const fingerprint = digest(readFileSync(input)).slice(0, 16);
    const before = join(archive, 'analytics-before-views-' + fingerprint + '.sqlite');
    if (!existsSync(before)) await analytics.raw.backup(before);
    const result = analytics.importViewTotals({ sourceId: snapshot.sourceId, capturedAt: snapshot.capturedAt, entries });
    const snapshotPath = join(archive, 'views-' + fingerprint + '.json');
    if (!existsSync(snapshotPath)) copyFileSync(input, snapshotPath);
    const publicEntries = site.visibleRelease()?.entries.filter((item) => item.kind === 'content') ?? [];
    const counts = analytics.viewTotals(publicEntries);
    const report = { ...result, publicArticles: publicEntries.length,
      publicViews: publicEntries.reduce((sum, item) => sum + (counts.get(item.id) ?? 0), 0),
      completedAt: now(), source: input, snapshotPath, before,
      ranking: publicEntries.map((item) => ({ id: item.id, path: item.path, title: item.title, views: counts.get(item.id) ?? 0 }))
        .sort((a, b) => b.views - a.views),
    };
    atomicJson(join(target, 'imports', 'wordpress-views-import.json'), report);
    return report;
  } finally { analytics.close(); site.close(); }
}

export async function migrateWordPress(source: string, target: string, dryRun = false) {
  const raw = read(join(source, 'wordpress-source.json'));
  if (raw.schema !== 'wordpress-source-export-v1') throw new WeavaError('不支持这个 WordPress 导出格式。');
  const articles = read(join(source, 'articles.json')) as any[];
  const assets = read(join(source, 'media-url-map.json')) as any[];
  const home = new URL(raw.options.home);
  const invalid: any[] = [];
  const media = new Map<string, { file: string; name: string; url: string; asset: any }>();
  const replacements = new Map<string, string>();
  for (const asset of assets) {
    const file = inside(source, asset.local_path);
    if (!['verified', 'downloaded'].includes(asset.status) || !existsSync(file) || digest(readFileSync(file)) !== asset.sha256) {
      invalid.push({ file: asset.local_path, reason: '图片缺失或校验失败' }); continue;
    }
    const name = asset.sha256.slice(0, 24) + extname(file).toLowerCase();
    const url = '/media/' + name;
    media.set(asset.sha256, { file, name, url, asset });
    for (const original of [asset.source_url, ...(asset.original_urls ?? [])]) {
      replacements.set(original, url);
      replacements.set(original.replaceAll('&', '&amp;'), url);
      try {
        const parsed = new URL(original);
        if (parsed.hostname === home.hostname) {
          for (const path of [parsed.pathname, decodeURI(parsed.pathname)]) {
            replacements.set(path, url);
            replacements.set('https://' + parsed.host + path, url);
            replacements.set('http://' + parsed.host + path, url);
          }
        }
      } catch {}
    }
  }
  for (const article of articles) {
    const file = inside(source, article.body_file);
    if (!existsSync(file) || digest(readFileSync(file)) !== article.body_sha256)
      invalid.push({ id: article.id, reason: '文章正文缺失或校验失败' });
  }
  if (invalid.length) throw new WeavaError('WordPress 来源资料校验失败。', 400, invalid);
  const rewriteUrl = (url: string) => {
    const embeddedLink = /^\[[^\]]*\]\(([^)]+)\)$/.exec(url);
    if (embeddedLink) url = embeddedLink[1];
    const image = replacements.get(url) ?? replacements.get(url.replaceAll('&amp;', '&'));
    if (image) return image;
    try {
      if (url === home.host || url.startsWith(home.host + '/')) url = home.protocol + '//' + url;
      const parsed = new URL(url, home);
      if (parsed.hostname === home.hostname) return parsed.pathname + parsed.search + parsed.hash;
    } catch {}
    return url;
  };
  const rewriteSegment = (text: string) => {
    text = text.replace(/[ \t]*\{\.alignnone\}/g, '');
    // Change link/image destinations while retaining visible text, labels and code.
    text = text.replace(/(\]\(\s*<?)([^\s)>]+)/g, (_all, prefix, url) => prefix + rewriteUrl(url));
    text = text.replace(/((?:href|src|poster)\s*=\s*["'])([^"']+)/gi, (_all, prefix, url) => prefix + rewriteUrl(url));
    text = text.replace(/^(\s*\[[^\]\r\n]+\]:\s*<?)([^\s>]+)/gm, (_all, prefix, url) => prefix + rewriteUrl(url));
    return text.replace(/<(https?:\/\/[^\s<>]+)>/g, (all, url) => {
      const rewritten = rewriteUrl(url);
      return rewritten === url ? all : `[${url.replace(/[\\[\]_*`]/g, '\\$&')}](${rewritten})`;
    });
  };
  const rewrite = (text: string) => {
    const code = /(?:^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^ {0,3}\1[ \t]*$)|(?:`+[^`\r\n]*`+)/gm;
    let result = '', cursor = 0;
    for (const match of text.matchAll(code)) {
      result += rewriteSegment(text.slice(cursor, match.index)) + match[0];
      cursor = match.index! + match[0].length;
    }
    return result + rewriteSegment(text.slice(cursor));
  };
  const entries: Entry[] = [];
  const categories = new Map<string, any>(), tags = new Map<string, any>();
  const redirects = new Map<string, { target: string; entryId?: string }>();
  redirects.set('/feed/', { target: '/rss.xml' });
  const skipped: any[] = [];
  const paths = new Map<string, string>();
  for (const article of articles) {
    if (article.status === 'auto-draft' && !article.source_fields.post_content) {
      skipped.push({ id: article.id, reason: '空自动草稿', preservedInSource: true }); continue;
    }
    const visibility = article.status === 'private' ? 'private' : 'public';
    const category = article.categories[0]?.slug ?? 'posts';
    const path = normalizePath(article.status === 'private'
      ? '/' + category + '/' + article.slug + '/'
      : new URL(article.original_url, home).pathname);
    const originalBody = readFileSync(inside(source, article.body_file), 'utf8');
    const body = rewrite(originalBody);
    const title = load('<span>' + article.title + '</span>')('span').text();
    const metadata = article.postmeta ?? {};
    const date = (gmt: string) => gmt && !gmt.startsWith('0000-') ? gmt.replace(' ', 'T') + 'Z' : undefined;
    const description = metadata.seo_desc?.[0] || article.excerpt || plain(renderDocument({ version: 1, format: 'markdown', source: body })).slice(0, 160);
    const coverAsset = assets.find((a) => a.local_path === article.cover_local_path);
    const value = entrySchema.parse({
      id: 'wordpress:' + article.id, kind: 'content', type: 'post', title, path,
      visibility, status: ['publish', 'private'].includes(article.status) ? 'published' : article.status === 'trash' ? 'archived' : 'draft',
      author: article.author?.display_name ?? '', description: plain(description),
      cover: coverAsset ? media.get(coverAsset.sha256)?.url ?? '' : '',
      categories: article.categories.map((t: any) => t.name), tags: article.tags.map((t: any) => t.name),
      document: { version: 1, format: 'markdown', source: body },
      createdAt: date(article.created_at_gmt), publishedAt: date(article.created_at_gmt),
      source: { system: 'wordpress', id: article.id, originalUrl: article.original_url, originalStatus: article.status, originalSlug: article.slug,
        originalBodySha256: article.body_sha256, modifiedAt: date(article.modified_at_gmt), metadata, categories: article.categories, tags: article.tags },
    });
    entries.push(value); paths.set(path, value.id);
    for (const term of article.categories) if (visibility === 'public') categories.set(term.slug, term);
    for (const term of article.tags) if (visibility === 'public') tags.set(term.slug, term);
    redirects.set('/?p=' + article.id, { target: path, entryId: value.id });
    for (const oldSlug of metadata._wp_old_slug ?? []) {
      const oldPath = normalizePath(path.slice(0, path.lastIndexOf('/', path.length - 2) + 1) + oldSlug + '/');
      if (oldPath !== path) redirects.set(oldPath, { target: path, entryId: value.id });
    }
  }
  const page = (id: string, title: string, path: string, blocks: any[]) => entrySchema.parse({ id, kind: 'page', title, path, blocks, status: 'published' });
  const block = (id: string, type: string, props: any) => ({ id, type, props });
  entries.push(page('wordpress:home', raw.options.blogname, '/', [
    block('blog-heading', 'hero', { title: raw.options.blogname, description: raw.options.blogdescription }),
    block('blog-articles', 'content-list', { contentType: 'post', limit: 500 }),
  ]));
  for (const [taxonomy, terms, basePath] of [
    ['category', categories, raw.options.category_base || 'category'],
    ['tag', tags, raw.options.tag_base || 'tag'],
  ] as const) {
    for (const [slug, term] of terms) {
      const path = normalizePath('/' + basePath + '/' + slug + '/');
      if (paths.has(path)) continue;
      entries.push(page('wordpress:' + taxonomy + ':' + term.term_id, term.name, path, [
        block('archive-heading', 'hero', { title: term.name, description: term.description || '' }),
        block('archive-articles', 'content-list', { [taxonomy]: term.name, contentType: 'post', limit: 500 }),
      ]));
    }
  }
  for (const entry of entries) {
    const existing = paths.get(entry.path);
    if (existing && existing !== entry.id) throw new WeavaError('WordPress 来源网址重复：' + entry.path);
    paths.set(entry.path, entry.id);
  }
  for (const [oldPath] of redirects) if (paths.has(oldPath)) redirects.delete(oldPath);
  for (const [from, to] of replacements)
    if (from.startsWith('/wp-content/uploads/')) redirects.set(normalizePath(from), { target: to });
  const unresolved: any[] = [];
  for (const entry of entries) {
    const $ = load(renderDocument(entry.document));
    $('a[href^="/"],img[src^="/"]').each((_i, node) => {
      const url = $(node).attr('href') ?? $(node).attr('src') ?? '';
      const parsed = new URL(url, home);
      const path = normalizePath(parsed.pathname);
      const queryKey = path === '/' && parsed.searchParams.has('p') ? '/?p=' + parsed.searchParams.get('p') : path;
      if (!paths.has(path) && !redirects.has(queryKey) && !path.startsWith('/media/') && !['/rss.xml','/sitemap.xml','/search/'].includes(path))
        unresolved.push({ id: entry.id, url });
    });
  }
  const settings: Settings = {
    ...defaultSettings, name: raw.options.blogname, description: raw.options.blogdescription,
    domain: home.origin, language: raw.options.WPLANG?.replace('_','-') || 'zh-CN', timezone: raw.options.timezone_string || 'Asia/Shanghai',
    footer: '© ' + raw.options.blogname, navigation: [{ label: '首页', url: '/' }, ...[...categories].map(([slug, term]) => ({ label: term.name, url: '/' + (raw.options.category_base || 'category') + '/' + slug + '/' }))],
    taxonomies: [...categories].map(([id, term]) => ({ id, label: term.name, description: term.description })),
  };
  const summary = { source, target, articles: entries.filter((e) => e.kind === 'content').length,
    publicArticles: entries.filter((e) => e.kind === 'content' && e.visibility === 'public').length,
    privateArticles: entries.filter((e) => e.visibility === 'private').length,
    pages: entries.filter((e) => e.kind === 'page').length, media: media.size, redirects: redirects.size,
    convertedAlignmentMarkers: articles.reduce((count, a) => count + (a.source_fields.post_content.match(/\{\.alignnone\}/g)?.length ?? 0), 0), skipped, unresolved };
  if (dryRun) return { ...summary, dryRun: true };
  if (unresolved.length) throw new WeavaError('文章中有尚未处理的站内链接。', 400, unresolved);
  const site = new Site(target);
  try {
    const desired = entries.map((entry) => ({ entry, hash: digest(entry) }));
    const conflicts: any[] = [];
    for (const { entry } of desired) {
      const existing = site.store.get('entry', entry.id), marker = site.store.get('import', entry.id);
      if (existing && existing.revision !== marker?.value.targetRevision) conflicts.push({ id: entry.id, reason: '目标内容已被编辑' });
    }
    const settingsMark = site.store.get('import', 'wordpress:settings');
    if (settingsMark && site.settings().revision !== settingsMark.value.targetRevision) conflicts.push({ id: 'settings', reason: '目标设置已被编辑' });
    if (conflicts.length) throw new WeavaError('目标存在修改，未覆盖内容。', 409, conflicts);
    const files = [...media.values()]; let cursor = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++];
        await uploadMedia(site, readFileSync(item.file), item.name);
      }
    }));
    const archive = join(target, 'imports', 'wordpress');
    mkdirSync(archive, { recursive: true });
    for (const name of ['wordpress-source.json','articles.json','attachments.json','site.json','article-links.csv','media-url-map.json','verification.json','checksums.sha256'])
      if (existsSync(join(source, name))) copyFileSync(join(source, name), join(archive, name));
    let changed = false;
    site.store.raw.transaction(() => {
      if (!site.store.get('type', 'post')) site.saveType({ id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article' },null);
      for (const { entry, hash } of desired) {
        const marker = site.store.get('import',entry.id);
        if (marker?.value.hash === hash) continue;
        const existing = site.store.get('entry',entry.id);
        const saved = site.saveEntry(entry,existing?.revision ?? null);
        site.store.put('import',entry.id,{ hash,targetRevision:saved.revision },marker?.revision ?? null);
        changed = true;
      }
      if (settingsMark?.value.hash !== digest(settings)) {
        const saved = site.saveSettings(settings,site.settings().revision);
        site.store.put('import','wordpress:settings',{ hash:digest(settings),targetRevision:saved.revision },settingsMark?.revision ?? null); changed=true;
      }
      for (const [from,value] of redirects) {
        const row = site.store.get('redirect',from);
        if (!row || digest(row.value) !== digest(value)) site.store.put('redirect',from,value,row?.revision ?? null);
      }
      if (changed || !site.release()) site.publish({ label:'从 WordPress 迁移' });
    }).immediate();
    const report = { ...summary, completedAt:now(), changed, releaseId:site.release()?.id,
      entries:desired.map(({entry})=>({ id:entry.id,path:entry.path,visibility:entry.visibility })), sourcePreserved:archive };
    atomicJson(join(target,'imports','wordpress-migration-report.json'),report);
    return report;
  } finally { site.close(); }
}
