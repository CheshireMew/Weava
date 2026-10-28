import type { Block, Entry, Release, PublishedEntry, FieldDefinition } from '@weava/contracts';
import { escape as e, renderDocument, articleOutline } from './documents.ts';
import { queryEntries, pageLinks } from './query.ts';
import { load } from 'cheerio';
import { validateBlockProps } from '@weava/contracts';
import { layoutFor, builtInLayouts } from './layouts.ts';
export interface RenderOptions {
  url?: URL; strict?: boolean; editable?: boolean; editBody?: boolean;
  editTemplate?: boolean;
  bodyDepth?: number; layoutStack?: string[];
}
function boundProps(block: Block, entry: Entry | undefined, release: Release, strict = false) {
  const props = { ...block.props };
  for (const [key, binding] of Object.entries(block.bindings ?? {})) {
    const source = binding.source === 'site' ? release.settings : binding.source === 'field' ? entry?.fields : entry;
    if (binding.source !== 'field' && !['title', 'description', 'cover', 'author', 'path', 'type', 'name', 'logo', 'footer'].includes(binding.key))
      throw new Error('无法绑定这个字段：' + binding.key);
    props[key] = source && Object.hasOwn(source, binding.key) ? (source as any)[binding.key] : '';
  }
  validateBlockProps(block.type, props, strict);
  return props;
}
export function resolveContentLinks(html: string, release: Release, strict = false) {
  if (!html.includes('entry:')) return html;
  const $ = load(html, null, false);
  $('[href^="entry:"]').each((_index, element) => {
    const href = $(element).attr('href')!.slice(6), hashAt = href.indexOf('#');
    const id = decodeURIComponent(hashAt < 0 ? href : href.slice(0, hashAt)), hash = hashAt < 0 ? '' : href.slice(hashAt);
    const target = release.entries.find((entry) => entry.id === id);
    if (!target) {
      if (strict) throw new Error('关联内容不存在或尚未发布：' + id);
      $(element).replaceWith($(element).contents());
    } else $(element).attr('href', target.path + hash);
  });
  return $.html();
}
export function renderNavigation(items: import('@weava/contracts').Navigation[], path?: string, release?: Release): string {
  const html = items.map((item) => `<div class="nav-branch"><a href="${e(item.url)}"${path === item.url ? ' aria-current="page"' : ''}>${e(item.label)}</a>${item.children?.length ? `<div class="nav-children">${renderNavigation(item.children, path)}</div>` : ''}</div>`).join('');
  return release ? resolveContentLinks(html, release) : html;
}
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
export function cards(entries: PublishedEntry[], types:import('@weava/contracts').ContentType[] = []) {
  return `<div class="cards">${entries.map((item) => `<a class="card" href="${e(item.path)}">${item.cover ? `<img src="${e(item.cover)}" alt="" loading="lazy" width="640" height="400">` : ''}<div><small>${e(item.categories.join(' · ') || types.find((type)=>type.id===item.type)?.label || '')}</small><h3>${e(item.title)}</h3><p>${e(item.description)}</p></div></a>`).join('')}</div>`;
}
export function renderBlocks(
  blocks: Block[],
  release: Release,
  entry?: Entry,
  custom: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {},
  options: RenderOptions = {},
): string {
  const render = (items: Block[]): string =>
    items
      .map((b): string => {
        const p = boundProps(b, entry, release, options.strict);
        const child = (): string => render(b.children ?? []);
        const text = () =>
          renderDocument({ version: 1, format: 'markdown', source: String(p.text ?? '') });
        const inner = (): string => { switch (b.type) {
          case 'text':
          case 'richtext':
            return `<section class="prose block">${text()}</section>`;
          case 'hero':
            return `<section class="hero block"><span class="eyebrow">${e(p.eyebrow ?? '')}</span><h1 data-weava-edit="${e(b.id)}:title">${e(p.title ?? entry?.title ?? '')}</h1><p data-weava-edit="${e(b.id)}:description">${e(p.description ?? '')}</p>${p.buttonLabel ? `<a class="button" href="${e(p.buttonUrl ?? '/')}">${e(p.buttonLabel)}</a>` : ''}${p.image ? `<img src="${e(p.image)}" alt="${e(p.alt)}" width="1200" height="600">` : ''}</section>`;
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
            return `<div class="gallery block">${(p.images ?? []).map((i: any) => `<figure><img src="${e(i.src ?? i)}" alt="${e(i.alt)}" loading="lazy">${i.caption?`<figcaption>${e(i.caption)}</figcaption>`:''}</figure>`).join('')}</div>`;
          case 'video':
            return `<figure class="block"><video src="${e(p.src)}" poster="${e(p.poster ?? '')}" controls preload="metadata" playsinline></video>${p.caption ? `<figcaption>${e(p.caption)}</figcaption>` : ''}</figure>`;
          case 'attachment':
            return `<p class="block"><a href="${e(p.url)}" download>${e(p.label ?? '下载附件')}</a></p>`;
          case 'content-list':
          case 'cards': {
            const key = String(p.pageKey || 'page');
            const page = Number(options.url?.searchParams.get(key) ?? 1);
            const fields = { ...p.fields };
            const definitions = release.types.find((type) => type.id === p.contentType)?.fields.filter((field) => field.filterable) ?? [];
            if (p.filters === 'show') for (const field of definitions) {
              const value = options.url?.searchParams.get('field.' + field.key);
              if (value) fields[field.key] = value;
            }
            const result = queryEntries(release.entries, { kind: 'content', type: p.contentType, category: p.category,
              tag: p.tag, query: p.query, sort: p.sort, fields, page,
              pageSize: Math.max(1, Math.min(100, Number(p.limit) || 24)) }, release.types, release.terms);
            const controls = p.filters === 'show' && definitions.length ? `<form class="content-filters" method="get">${[...(options.url?.searchParams ?? [])].filter(([name]) => name !== key && !name.startsWith('field.')).map(([name,value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`).join('')}${definitions.map((field) => {
              const value = options.url?.searchParams.get('field.' + field.key) ?? '', choices = field.type === 'boolean' ? ['true','false'] : field.type === 'select' ? field.options : undefined;
              return `<label>${e(field.label)}${choices ? `<select aria-label="${e(field.label)}" name="field.${e(field.key)}"><option value="">全部</option>${choices.map((choice) => `<option value="${e(choice)}"${choice === value ? ' selected' : ''}>${field.type === 'boolean' ? choice === 'true' ? '是' : '否' : e(choice)}</option>`).join('')}</select>` : `<input aria-label="${e(field.label)}" name="field.${e(field.key)}" type="${field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}" value="${e(value)}">`}</label>`;
            }).join('')}<button type="submit">筛选</button></form>` : '';
            const links = options.url ? pageLinks(result, options.url, key) : null;
            const pagination = links && result.pages > 1 ? `<nav class="pagination" aria-label="列表分页">${links.previous ? `<a rel="prev" href="${e(links.previous)}">上一页</a>` : ''}<span>${page} / ${result.pages}</span>${links.next ? `<a rel="next" href="${e(links.next)}">下一页</a>` : ''}</nav>` : '';
            return `<section class="block">${p.title ? `<h2>${e(p.title)}</h2>` : ''}${controls}${cards(result.items,release.types)}${pagination}</section>`;
          }
          case 'taxonomy': {
            const terms = (release.terms ?? []).filter((term) => term.kind === 'category');
            const visible = new Set([...release.settings.taxonomies.map((term) => term.id), ...release.entries.filter((entry) => entry.visibility !== 'private').flatMap((entry) => entry.termIds?.categories ?? [])]);
            let changed = true; while (changed) { changed = false; for (const term of terms) if (visible.has(term.id) && term.parentId && !visible.has(term.parentId)) { visible.add(term.parentId); changed = true; } }
            const catalog = terms.filter((term) => visible.has(term.id));
            if (!catalog.length) return `<nav class="tags block">${release.settings.taxonomies.map((term) => `<a href="${e(p.basePath ?? '/search/')}?category=${encodeURIComponent(term.id)}">${e(term.label)}</a>`).join('')}</nav>`;
            const tree = (parent?: string): string => `<ul>${catalog.filter((term) => term.parentId === parent || !parent && term.parentId && !catalog.some((item) => item.id === term.parentId)).map((term) => `<li><a href="${e(p.basePath ?? '/search/')}?category=${encodeURIComponent(term.id)}">${e(term.label)}</a>${catalog.some((item) => item.parentId === term.id) ? tree(term.id) : ''}</li>`).join('')}</ul>`;
            return `<nav class="taxonomy-tree block">${tree()}</nav>`;
          }
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
          case 'entry-heading': {
            if (!entry) return '';
            const date = entry.publishedAt ? new Intl.DateTimeFormat(release.settings.language, { timeZone: release.settings.timezone, dateStyle: 'medium' }).format(new Date(entry.publishedAt)) : '';
            return `<header class="article-heading"><h1>${e(entry.title)}</h1>${entry.visibility === 'private' ? '<span>私密</span>' : ''}<div class="meta">${e(entry.author)}${date ? ' · ' + e(date) : ''}</div>${entry.cover && p.cover !== 'hide' ? `<img class="cover" src="${e(entry.cover)}" alt="">` : ''}</header>`;
          }
          case 'entry-body': {
            if (!entry) return '';
            if (options.bodyDepth) throw new Error('内容正文不能循环引用。');
            const html=entry.blocks.length ? renderBlocks(entry.blocks, release, entry, custom, { ...options, bodyDepth: 1, editable: options.editBody ?? options.editable }) : `<article class="prose">${renderDocument(entry.document)}</article>`;
            return articleOutline(html).html;
          }
          case 'entry-toc':{
            if(!entry)return '';
            const strip=(blocks:Block[]):Block[]=>blocks.filter((block)=>block.type!=='entry-toc').map((block)=>({...block,...(block.children?{children:strip(block.children)}:{})}));
            const html=entry.blocks.length?renderBlocks(strip(entry.blocks),release,entry,custom,{...options,editable:false,bodyDepth:1}):renderDocument(entry.document);
            const outline=articleOutline(html);return outline.items.length?`<nav class="document-outline" aria-label="正文目录">${outline.items.map((item)=>`<a href="#${e(item.id)}" style="--outline-depth:${item.level-2}">${e(item.title)}</a>`).join('')}</nav>`:'';
          }
          case 'entry-fields': {
            if (!entry) return '';
            const fields = release.types.find((type) => type.id === entry.type)?.fields ?? [];
            const keys = String(p.keys ?? '').split(',').map((key) => key.trim()).filter(Boolean);
            if (keys.some((key) => !fields.some((field) => field.key === key))) throw new Error('模板引用的内容字段不存在。');
            return renderFields(keys.length ? fields.filter((field) => keys.includes(field.key)) : fields, entry.fields, release);
          }
          case 'shared': {
            const id = String(p.layoutId ?? '');
            if (options.layoutStack?.includes(id)) throw new Error('共享区域循环引用：' + id);
            const region = release.layouts?.find((layout) => layout.id === id && layout.kind === 'region');
            if (!region) throw new Error('共享区域不存在：' + id);
            return renderBlocks(region.blocks, release, entry, custom, { ...options, editable: false, layoutStack: [...(options.layoutStack ?? []), id] });
          }
          case 'site-brand':
            return `<a class="brand" href="/">${release.settings.logo ? `<img src="${e(release.settings.logo)}" alt="" width="32" height="32">` : ''}${e(release.settings.name)}</a>`;
          case 'navigation':
            return `<nav class="shared-navigation">${renderNavigation(release.settings.navigation, entry?.path, release)}</nav>`;
          case 'compatibility':
            return String(p.html ?? '');
          default:
            if (custom[b.type]) return custom[b.type]({ ...b, props: p }, release, entry);
            throw new Error('区块渲染器未注册：' + b.type);
        } };
        let html = inner();
        if (b.style) {
          const style = b.style;
          const css = [style.align ? `text-align:${style.align}` : '', style.padding !== undefined ? `padding:${style.padding}px` : '',
            style.gap !== undefined ? `--space:${style.gap}px` : '', style.background ? `background:${style.background}` : '',
            style.columns ? `--cols-desktop:${style.columns.desktop};--cols-tablet:${style.columns.tablet};--cols-mobile:${style.columns.mobile}` : ''].filter(Boolean).join(';');
          html = `<div class="layout-block width-${style.width ?? 'normal'}${style.columns ? ' responsive-columns' : ''}" style="${e(css)}">${html}</div>`;
        }
        return options.editable ? `<div data-weava-block="${e(b.id)}">${html}</div>` : html;
      })
      .join('');
  return resolveContentLinks(render(blocks), release, options.strict);
}
export function renderEntryTemplate(entry: Entry, release: Release, custom: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {}, options: RenderOptions = {}) {
  const template = layoutFor(entry, release);
  return `<div class="entry-template template-${e(template.id)}" data-template="${e(template.id)}">${renderBlocks(template.blocks, release, entry, custom, { ...options, editable: options.editTemplate, editBody: options.editTemplate ? false : options.editable })}</div>`;
}
export function renderSharedRegion(position: 'header' | 'before' | 'after' | 'footer', release: Release, entry?: Entry, custom: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {}, options: RenderOptions = {}) {
  const id = release.settings.regions?.[position];
  return id ? renderBlocks([{ id: position, type: 'shared', props: { layoutId: id } }], release, entry, custom, options) : '';
}
