import type { Block, Entry, Release, PublishedEntry, FieldDefinition } from '@weava/contracts';
import { escape as e, renderDocument } from './documents.ts';
export function renderFields(
  defs: FieldDefinition[],
  values: Record<string, any>,
  release: Release,
): string {
  const rows = defs.flatMap((d) => {
    const value = values[d.key];
    if (value === undefined || value === null || value === '') return [];
    const items = d.multiple ? value : [value];
    const html = items
      .map((v: any) => {
        switch (d.type) {
          case 'reference': {
            const target = release.entries.find((entry) => entry.id === v);
            return target ? `<a href="${e(target.path)}">${e(target.title)}</a>` : '';
          }
          case 'media':
            return /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(v)
              ? `<img src="${e(v)}" alt="${e(d.label)}" loading="lazy">`
              : `<a href="${e(v)}">${e(d.label)}</a>`;
          case 'richtext':
            return renderDocument({ version: 1, format: 'markdown', source: v });
          case 'boolean':
            return v ? '是' : '否';
          case 'group':
            return renderFields(d.fields ?? [], v, release);
          default:
            return e(v);
        }
      })
      .join('、');
    return [`<dt>${e(d.label)}</dt><dd>${html}</dd>`];
  });
  return rows.length ? `<dl class="content-fields">${rows.join('')}</dl>` : '';
}
export function cards(entries: PublishedEntry[]) {
  return `<div class="cards">${entries.map((item) => `<a class="card" href="${e(item.path)}">${item.cover ? `<img src="${e(item.cover)}" alt="" loading="lazy" width="640" height="400">` : ''}<div><small>${e(item.categories.join(' · ') || item.type)}</small><h3>${e(item.title)}</h3><p>${e(item.description)}</p></div></a>`).join('')}</div>`;
}
export function renderBlocks(
  blocks: Block[],
  release: Release,
  entry?: Entry,
  custom: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {},
): string {
  const render = (items: Block[]): string =>
    items
      .map((b): string => {
        const p = b.props;
        const child = (): string => render(b.children ?? []);
        const text = () =>
          renderDocument({ version: 1, format: 'markdown', source: String(p.text ?? '') });
        switch (b.type) {
          case 'text':
          case 'richtext':
            return `<section class="prose block">${text()}</section>`;
          case 'hero':
            return `<section class="hero block"><span class="eyebrow">${e(p.eyebrow ?? '')}</span><h1>${e(p.title ?? entry?.title ?? '')}</h1><p>${e(p.description ?? '')}</p>${p.buttonLabel ? `<a class="button" href="${e(p.buttonUrl ?? '/')}">${e(p.buttonLabel)}</a>` : ''}${p.image ? `<img src="${e(p.image)}" alt="${e(p.alt)}" width="1200" height="600">` : ''}</section>`;
          case 'button':
            return `<div class="block"><a class="button" href="${e(p.url ?? '/')}">${e(p.label ?? '了解更多')}</a></div>`;
          case 'image-text':
            return `<section class="image-text block"><img src="${e(p.src)}" alt="${e(p.alt)}" loading="lazy"><div><h2>${e(p.title)}</h2>${text()}</div></section>`;
          case 'container':
            return `<section class="block">${child()}</section>`;
          case 'columns':
            return `<section class="columns block" style="--columns:${Math.min(4, Math.max(1, Number(p.columns) || 2))}">${child()}</section>`;
          case 'image':
            return `<figure class="block"><img src="${e(p.src)}" alt="${e(p.alt)}" loading="lazy">${p.caption ? `<figcaption>${e(p.caption)}</figcaption>` : ''}</figure>`;
          case 'gallery':
            return `<div class="gallery block">${(p.images ?? []).map((i: any) => `<figure><img src="${e(i.src ?? i)}" alt="${e(i.alt)}" loading="lazy"></figure>`).join('')}</div>`;
          case 'video':
            return `<figure class="block"><video src="${e(p.src)}" poster="${e(p.poster ?? '')}" controls preload="metadata" playsinline></video>${p.caption ? `<figcaption>${e(p.caption)}</figcaption>` : ''}</figure>`;
          case 'attachment':
            return `<p class="block"><a href="${e(p.url)}" download>${e(p.label ?? '下载附件')}</a></p>`;
          case 'content-list':
          case 'cards': {
            let list = release.entries.filter(
              (v) =>
                v.kind === 'content' &&
                (!p.contentType || v.type === p.contentType) &&
                (!p.category || v.categories.includes(p.category)) &&
                (!p.tag || v.tags.includes(p.tag)) &&
                (!p.query || (v.title + v.description).includes(p.query)),
            );
            list.sort((a, b) =>
              p.sort === 'title'
                ? a.title.localeCompare(b.title)
                : String(b.publishedAt).localeCompare(String(a.publishedAt)),
            );
            const limit = Math.max(1, Math.min(500, Number(p.limit) || 24));
            return `<section class="block">${p.title ? `<h2>${e(p.title)}</h2>` : ''}${cards(list.slice(0, limit))}</section>`;
          }
          case 'taxonomy':
            return `<nav class="tags block">${release.settings.taxonomies.map((t) => `<a href="${e(p.basePath ?? '/search/')}?q=${encodeURIComponent(t.label)}">${e(t.label)}</a>`).join('')}</nav>`;
          case 'content-detail': {
            const target = p.entryId ? release.entries.find((e) => e.id === p.entryId) : entry;
            return `<article class="prose block">${target ? renderDocument(target.document) : ''}</article>`;
          }
          case 'faq':
            return `<section class="block">${(p.items ?? []).map((i: any) => `<details><summary>${e(i.question)}</summary><div class="prose">${renderDocument({ version: 1, format: 'markdown', source: i.answer ?? '' })}</div></details>`).join('')}</section>`;
          case 'callout':
            return `<aside class="callout block">${p.title ? `<strong>${e(p.title)}</strong>` : ''}${text()}</aside>`;
          case 'divider':
            return '<hr class="block">';
          case 'spacer':
            return `<div style="height:${Math.min(240, Math.max(0, Number(p.height) || 32))}px" aria-hidden="true"></div>`;
          case 'compatibility':
            return String(p.html ?? '');
          default:
            if (custom[b.type]) return custom[b.type](b, release, entry);
            throw new Error('区块渲染器未注册：' + b.type);
        }
      })
      .join('');
  return render(blocks);
}
