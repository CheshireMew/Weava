import {siteText} from '@weava/contracts';
import { load } from 'cheerio';
import { entrySchema, WeavaError, isReservedContentPath, type PublishedEntry, type Settings, type Entry } from '@weava/contracts';
import { siteInfoSchema, type SiteInfo } from '../../contracts/src/site-info.ts';
import { renderDocument, escape as escapeHtml } from './documents.ts';
import { normalizePath } from './paths.ts';
import type { Site } from './site.ts';

const paths = { about: ['/about/'], friends: ['/friendlink/', '/friends/', '/links/'] };
const legacyInfo=new WeakMap<object,{key:string;value:SiteInfo}>();

/** Read legacy information without rewriting entries or settings on a visit. */
export function resolveSiteInfo(site: Pick<Site, 'store' | 'settings'>): SiteInfo {
  const configured = siteInfoSchema.parse(site.settings().value.siteInfo ?? {});
  if(configured.about&&configured.friends)return configured;
  const candidates = site.store.raw.prepare("SELECT r.id,r.revision,r.data FROM entry_list l JOIN records r ON r.scope='entry' AND r.id=l.id WHERE l.kind='page' AND json_extract(l.summary,'$.path') IN ('/about/','/friendlink/','/friends/','/links/')").all() as { id:string;revision:number;data: string }[];
  const key=candidates.map(row=>row.id+':'+(row.revision??row.data)).join('|'),cached=legacyInfo.get(site.store);
  if(cached?.key===key)return {about:configured.about??structuredClone(cached.value.about),friends:configured.friends??structuredClone(cached.value.friends)};
  const entries = candidates.map(row => JSON.parse(row.data) as Entry);
  const about = entries.find(entry => paths.about.includes(entry.path));
  const friends = entries.find(entry => paths.friends.includes(entry.path));
  const fragment = (source: string) => /<\/?[a-z][^>]*>/i.test(source) ? source : renderDocument({ version: 1, format: 'markdown', source });
  const html = (entry?: Entry): string => entry ? entry.blocks.length
    ? entry.blocks.map(block => ['richtext', 'text'].includes(block.type) ? fragment(String(block.props.text ?? '')) : '').join('\n')
    : entry.document.format === 'html' ? entry.document.source : renderDocument(entry.document) : '';
  const aboutDoc = load(html(about)), friendDoc = load(html(friends));
  aboutDoc('script,style').remove();
  aboutDoc('br').replaceWith('\n'); aboutDoc('p,li,h1,h2,h3,h4,h5,h6').append('\n\n');
  const links: NonNullable<SiteInfo['friends']>['links'] = [];
  friendDoc('a[href]').each((_index, node) => {
    const link = friendDoc(node), url = link.attr('href') ?? '';
    if (!/^https?:\/\//i.test(url)) return;
    const name = link.find('h2,h3,h4,h5,h6').first().text().trim() || link.text().trim() || link.find('img').attr('alt') || url;
    const description = link.find('.links-desc,.description,p').first().text().trim();
    if (!links.some(item => item.url === url)) links.push({ name, url, description });
  });
  // Some imported friend entries contain a heading with no surviving link URL.
  if (!links.length) friendDoc('h2,h3,h4,h5,h6').each((_index, node) => {
    const name = friendDoc(node).text().trim(); if (name) links.push({ name, url: '', description: '' });
  });
  const value:SiteInfo={
    about: { enabled: about?.status === 'published' && about.visibility !== 'private', path: about?.path ?? '/about/', ...(about ? { entryId: about.id } : {}), text: aboutDoc.root().text().trim().replace(/\n{3,}/g, '\n\n') },
    friends: { enabled: friends?.status === 'published' && friends.visibility !== 'private', path: friends?.path ?? '/friendlink/', ...(friends ? { entryId: friends.id } : {}), links },
  };
  legacyInfo.set(site.store,{key,value});return {about:configured.about??structuredClone(value.about),friends:configured.friends??structuredClone(value.friends)};
}

/** Publish fixed information pages from settings; legacy records remain intact. */
export function applySiteInfo(entries: Map<string, PublishedEntry>, settings: Settings, revision: number, time: string, previous: PublishedEntry[] = []) {
  const info = siteInfoSchema.parse(settings.siteInfo ?? {});
  for (const role of ['about', 'friends'] as const) {
    const config = info[role]; if (!config) continue;
    const path = normalizePath(config.path);
    if (path === '/' || isReservedContentPath(path)) throw new WeavaError('网站介绍或友情链接的网址无效。');
    const old = [...entries.values()].find(entry => entry.path === path) ?? previous.find(entry => entry.path === path);
    if (old?.kind === 'content') throw new WeavaError('这个网址已经被文章使用：' + path);
    if (!config.enabled) { if (old) entries.delete(old.id); continue; }
    const title = siteText(settings.language,role === 'about' ? '关于本站' : '友情链接');
    let body: string;
    if (role === 'about') body = (config as NonNullable<SiteInfo['about']>).text.trim().split(/\n\s*\n/).filter(Boolean).map(text => '<p>' + escapeHtml(text).replaceAll('\n', '<br>') + '</p>').join('');
    else {
      const links = (config as NonNullable<SiteInfo['friends']>).links;
      body = '<ul class="site-friend-links">' + links.map((link, index) => {
        if (!link.name.trim()) throw new WeavaError(`请填写第 ${index + 1} 个友情链接的网站名称。`);
        let url: URL; try { url = new URL(link.url); } catch { throw new WeavaError(`请填写“${link.name}”的完整网址。`); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new WeavaError(`“${link.name}”的网址需要以 http:// 或 https:// 开头。`);
        return `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.name)}</a>${link.description ? '<p>' + escapeHtml(link.description) + '</p>' : ''}</li>`;
      }).join('') + '</ul>';
      if (!links.length) body = '<p>'+escapeHtml(siteText(settings.language,'暂时还没有友情链接。'))+'</p>';
    }
    const html = `<section class="site-information"><h1>${title}</h1>${body}</section>`;
    const published = previous.find(entry => entry.id === old?.id);
    if (published?.source?.siteInfoRole === role && published.html === html && published.path === path) { entries.set(published.id, published); continue; }
    const value = entrySchema.parse({ ...old, id: old?.id ?? config.entryId ?? 'site-info:' + role, kind: 'page', path, title, template: 'page', status: 'published',
      blocks: [], document: { version: 1, format: 'html', source: html }, description: role === 'about' ? (config as NonNullable<SiteInfo['about']>).text.slice(0, 160) : siteText(settings.language,'友情链接'),
      allowComments: false, visibility: 'public', source: { ...old?.source, siteInfoRole: role } });
    entries.set(value.id, { ...value, html, publishedAt: old?.publishedAt ?? time, modifiedAt: time, revisionId: old?.revisionId ?? revision });
  }
}
