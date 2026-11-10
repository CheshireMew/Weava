import {textFor} from '@weava/contracts';
import type { Block, Entry, PublishedEntry, Release } from '@weava/contracts';
import { escape as e, renderBlocks, entryCover } from '@weava/core';
import { collectionEntries, collectionPage } from '../../../../packages/core/src/collections.ts';

export const arrow = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
export function libraryCard(item: PublishedEntry, release: Release) {
  const t=textFor(release.settings.language);
  const type = release.types.find(t => t.id === item.type), cover = entryCover(item, type);
  const categories = item.categories.map(value => release.settings.taxonomies.find(term=>term.id===value)?.label || release.terms?.find(term=>term.id===value)?.label || value);
  return `<article class="content-card"><a class="card-visual" href="${e(item.path)}" tabindex="-1" aria-hidden="true">${cover ? `<img src="${e(cover)}" alt="" loading="lazy" decoding="async" width="640" height="360">` : '<div class="card-placeholder">↗</div>'}${item.fields.kind==='video'?'<span class="play-badge">▶</span>':''}</a><div class="card-info"><span class="card-category">${e(categories.join(' · ') || type?.label || '')}</span><h3><a href="${e(item.path)}">${e(item.title)}</a></h3><div class="card-bottom"><span>${e(t('{count} 分钟阅读',{count:Math.max(1,Number(item.fields.readMinutes)||Math.ceil((item.html?.length||500)/500))}))}</span><a href="${e(item.path)}" aria-label="${e(t('阅读：{name}',{name:item.title}))}">${arrow}</a></div></div></article>`;
}
export function libraryBlocks(blocks: Block[], release: Release, entry: Entry, url: URL, custom: Record<string,any>) {
  const t=textFor(release.settings.language);
  return renderBlocks(blocks, release, entry, custom, { url, blockRenderer(block) {
    const p = block.props;
    const heading = p.title ? `<div class="section-heading"><h2>${e(p.title)}</h2></div>` : '';
    if (block.type === 'hero') return `<section class="hero wrap"><div class="hero-copy"><h1>${e(p.title || entry.title).replaceAll('\n','<br>').replace(e(p.highlight || '\u0000'),'<span>'+e(p.highlight || '')+'</span>')}</h1><p>${e(p.description || '')}</p><div class="hero-actions">${p.buttonLabel ? `<a class="button lime" href="${e(p.buttonUrl || '/')}">${e(p.buttonLabel)} ${arrow}</a>` : ''}${p.secondaryLabel ? `<a class="hero-secondary" href="${e(p.secondaryUrl)}">${e(p.secondaryLabel)}</a>` : ''}</div></div>${p.image ? `<div class="hero-visual"><img class="hero-art" src="${e(p.image)}" alt=""></div>` : ''}</section>`;
    if (block.type === 'link-list') {
      const presentation = p.presentation || 'links';
      const items = (p.items || []).map((link: any, i: number) => {
        const target = release.entries.find(item => item.path === link.url);
        const collection = target?.blocks.find(b => b.type === 'collection');
        const count = collection && ['tiles','topics'].includes(presentation) ? collectionEntries(release,collection.props).length : null;
        return `<a href="${e(link.url)}" class="${presentation==='tiles'?'platform-tile':presentation==='topics'?'topic-card':''}">${presentation==='steps'?`<span class="step-number">${String(i+1).padStart(2,'0')}</span>`:''}${link.icon?`<span class="platform-symbol">${e(link.icon)}</span>`:''}<div><h3>${e(link.label)}</h3><p>${e(count === null ? link.description || '' : t('{count} 篇资料',{count}))}</p></div>${arrow}</a>`;
      }).join('');
      return `<section class="${presentation==='tiles'?'platform-overview':presentation==='steps'?'start-strip':'section'} wrap">${heading}<div class="${presentation==='topics'?'topic-grid':presentation==='links'?'library-links':'library-link-items'}">${items}</div></section>`;
    }
    if (block.type !== 'collection') return undefined;
    if (p.presentation !== 'catalog') {
      const items = collectionEntries(release,p).slice(0,Number(p.limit)||6);
      return `<section class="section wrap">${heading}${p.presentation==='list'?`<ol class="library-course">${items.map(item=>`<li><a href="${e(item.path)}">${e(item.title)}</a></li>`).join('')}</ol>`:`<div class="card-grid">${items.map(item=>libraryCard(item,release)).join('')}</div>`}</section>`;
    }
    const page = collectionPage(release,block,url);
    const base = p.basePath || entry.path.replace(/page\/\d+\/$/,'');
    const fieldDefs = [...new Map(release.types.filter(t=>!p.contentType||t.id===p.contentType).flatMap(t=>t.fields.filter(f=>f.filterable&&f.type==='select')).map(f=>[f.key,f])).values()];
    const filter = `<form class="library-filter" method="get" action="${e(base)}"><input type="search" name="q" aria-label="${e(t("筛选当前资料"))}" placeholder="${e(t("搜索资料"))}" value="${e(url.searchParams.get('q')||'')}">${fieldDefs.map(f=>`<label>${e(f.label)}<select name="field.${e(f.key)}"><option value="">${e(t("全部"))}</option>${(f.options||[]).map(v=>`<option value="${e(v)}"${url.searchParams.get('field.'+f.key)===v?' selected':''}>${e(f.optionLabels?.[v] || v)}</option>`).join('')}</select></label>`).join('')}<label>${e(t("排序"))}<select name="sort"><option value="date">${e(t("最新"))}</option><option value="title"${url.searchParams.get('sort')==='title'?' selected':''}>${e(t("标题"))}</option><option value="oldest"${url.searchParams.get('sort')==='oldest'?' selected':''}>${e(t("最早"))}</option></select></label><button class="button dark">${e(t("筛选"))}</button></form>`;
    const catalogueLinks = release.entries.filter(item=>item.kind==='page'&&!/\/page\/\d+\/$/.test(item.path)&&item.blocks.some(b=>b.type==='collection'&&b.props.presentation==='catalog'));
    const sidebar = `<aside class="catalog-sidebar"><span class="sidebar-label">${e(t("探索主题"))}</span>${catalogueLinks.map(item=>{const b=item.blocks.find(b=>b.type==='collection')!;return `<a class="sidebar-link" href="${e(item.path)}"${item.path===base?' aria-current="page"':''}>${e(item.title)} <small>${collectionEntries(release,b.props).length}</small></a>`;}).join('')}</aside>`;
    const links = Array.from({length:page.pages},(_,i)=>{const next=new URL(url);next.pathname=i?base+'page/'+(i+1)+'/':base;next.searchParams.delete('page');return `<a href="${e(next.pathname+next.search)}"${page.page===i+1?' aria-current="page"':''}>${i+1}</a>`;}).join('');
    return `<div class="catalog-layout wrap">${sidebar}<section class="catalog-main">${p.filters==='hide'?'':filter}<p class="results-meta">${e(t('{count} 篇资料',{count:page.total}))}</p><div class="card-grid">${page.items.map(item=>libraryCard(item,release)).join('')}</div>${!page.total?`<p role="status">${e(t('没有找到相关资料，请调整筛选条件。'))}</p>`:''}<nav class="pagination" aria-label="${e(t("资料分页"))}">${links}</nav></section></div>`;
  }});
}
