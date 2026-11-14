import { load } from 'cheerio';
import { escape } from './html.ts';
import { normalize, configFor } from './referrals.ts';
export async function renderLegacy(
  entry: any,
  release: any,
  {
    renderDocument,
    renderBlocks,
  }: { renderDocument: (...args: any[]) => string; renderBlocks: (...args: any[]) => string },
) {
  if (release.settings.theme !== 'crypto-blacknico') return null;
  let c = entry.compatibility;
  if (!c?.shell) {
    const base = release.entries.find((v: any) => v.path === '/')?.compatibility;
    if (!base) return null;
    c = {
      ...base,
      article: false,
      main: `<section class="page-heading wrap"><h1>${escape(entry.title)}</h1><p>${escape(entry.description)}</p></section><section class="wrap"><article class="article-body">${entry.kind === 'content' ? renderDocument(entry.document) : renderBlocks(entry.blocks, release, entry)}</article></section>`,
    };
  }
  const $ = load('<main>' + c.main + '</main>');
  if (entry.kind === 'page' && entry.blocks?.length)
    $('main').html(renderBlocks(entry.blocks, release, entry));
  const publicMap = new Map(release.entries.map((v: any) => [v.path, v]));
  if (c.article) {
    const target = $('article.article-body').first();
    if (target.length) {
      const body = renderDocument(entry.document);
      target.html(body);
    }
    $('h1').first().text(entry.title);
    $('.article-deck,.article-description').first().text(entry.description);
  }
  $('a[href^="/"]').each((_i, el) => {
    const a = $(el),
      href = a.attr('href')?.split(/[?#]/)[0] ?? '';
    const item: any = publicMap.get(href);
    if (item) {
      if (a.parent().is('h2,h3')) a.text(item.title);
      a.find('h2,h3').first().text(item.title);
      a.closest('.content-card').attr('data-title', item.title);
      if (a.hasClass('content-card') || a.hasClass('article-card'))
        a.find('p').first().text(item.description);
    } else if (/^\/(guides|learn)\/[^/]+\/$/.test(href)) {
      if (a.closest('.content-card,.article-card').length)
        a.closest('.content-card,.article-card').remove();
    }
  });
  const config = configFor(release);
  $('a[href^="http"]').each((_i, el) => {
    const a = $(el);
    a.attr('href', normalize(a.attr('href')!, config));
  });
  let head = c.head
    .replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escape(entry.title)} · ${escape(release.settings.name)}</title>`,
    )
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${escape(entry.description)}">`,
    );
  head = head.replace(
    /<link rel="canonical" href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${escape(release.settings.domain + entry.path)}">`,
  );
  let result = c.shell
    .replace('__WEAVA_HEAD__', head)
    .replace('__WEAVA_MAIN__', $('main').html() ?? '');
  const doc = load(result);
  const nav = doc('#main-nav');
  if (nav.length)
    nav.html(
      release.settings.navigation
        .map((n: any) => `<a href="${escape(n.url)}">${escape(n.label)}</a>`)
        .join(''),
    );
  doc('body').attr('data-release', release.id);
  const theme = release.settings.themeConfig;
  doc('head').append(
    `<style>:root{--green:${escape(theme.accent)};--paper:${escape(theme.background ?? '#f6f8f3')};--radius:${Number(theme.radius)}px;--max:${Number(theme.width)}px;--weava-space:${Number(theme.spacing ?? 24)}px;font-family:${escape(theme.font ?? 'system-ui,sans-serif')}}.card-grid,.article-cards{gap:var(--weava-space)}</style>`,
  );
  if (release.settings.logo)
    doc('.brand-mark').replaceWith(
      `<img src="${escape(release.settings.logo)}" alt="" width="38" height="38">`,
    );
  doc('meta[property="og:title"],meta[name="twitter:title"]').attr('content', entry.title);
  doc('meta[property="og:description"],meta[name="twitter:description"]').attr(
    'content',
    entry.description,
  );
  doc('meta[property="og:url"]').attr('content', release.settings.domain + entry.path);
  if (entry.cover)
    doc('meta[property="og:image"],meta[name="twitter:image"]').attr(
      'content',
      new URL(entry.cover, release.settings.domain).href,
    );
  doc('meta[name="robots"]').attr('content', entry.indexable ? 'index, follow' : 'noindex, follow');
  doc('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse(doc(el).text());
      const update = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(update);
          return;
        }
        if (['Article', 'BlogPosting', 'WebPage'].includes(value['@type']))
          Object.assign(value, {
            headline: entry.title,
            name: entry.title,
            description: entry.description,
            url: release.settings.domain + entry.path,
            ...(entry.publishedAt ? { datePublished: entry.publishedAt } : {}),
            ...(entry.modifiedAt ? { dateModified: entry.modifiedAt } : {}),
          });
        if (value['@graph']) update(value['@graph']);
      };
      update(data);
      doc(el).text(JSON.stringify(data).replaceAll('<', '\\u003c'));
    } catch {}
  });
  return doc.html();
}
