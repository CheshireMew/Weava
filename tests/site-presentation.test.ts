import { expect, it } from 'vitest';
import { defaultSettings, entrySchema, type PublishedEntry, type Release } from '@weava/contracts';
import { settingsSchema } from '../packages/contracts/src/api-models.ts';
import { featuredEntries, entrySummary } from '../packages/core/src/editorial.ts';
import { newsletterCatalog } from '../packages/core/src/newsletter.ts';
import { pageMetadata } from '../packages/core/src/seo.ts';
import { mediaReferencesIn } from '../packages/core/src/media-references.ts';
import { imageAttributes, responsiveImages } from '../packages/core/src/media.ts';
import {checkEntry} from '../packages/core/src/content-validation.ts';
import {renderEntryTemplate} from '../packages/core/src/render.ts';

const post = (id: string, extra = {}): PublishedEntry => ({ ...entrySchema.parse({ id, title: id, path: '/' + id + '/', kind: 'content', status: 'published', document: { version: 1, format: 'markdown', source: '正文第一段。' }, ...extra }), html: '<p>正文第一段。</p>', publishedAt: '2026-11-01T00:00:00Z', modifiedAt: '2026-11-01T00:00:00Z', revisionId: 1 });
it('allows an untitled working draft while requiring a title for publication',()=>{
 const value=entrySchema.parse({id:'draft',kind:'page',path:'/draft/',title:'',document:{version:1,format:'markdown',source:'正文草稿'}});
 const site={store:{get:()=>null},settings:()=>({value:defaultSettings}),validateBlocks:()=>{},fieldWidgets:{}} as any;
 expect(checkEntry(site,value,{required:false}).valid).toBe(true);
 expect(checkEntry(site,value).errors).toContainEqual({path:'title',message:'请填写标题。',code:'required'});
});
it('renders an article author in its visible byline',()=>{
 const entry=post('author',{author:'柴郡',template:'article'});
 const release={id:'release',createdAt:'',label:'',entries:[entry],types:[],settings:defaultSettings,terms:[]} as Release;
 expect(renderEntryTemplate(entry,release)).toContain('柴郡');
});
it('derives empty summaries including older manual-mode records while keeping explicit descriptions', () => {
  expect(entrySchema.parse({ id: 'a', title: 'a', path: '/a/', kind: 'content' }).summaryMode).toBe('auto');
  expect(entrySummary(post('a', { summaryMode: 'manual' }))).toBe('正文第一段。');
  expect(entrySummary(post('a', { description: '单独填写的摘要' }))).toBe('单独填写的摘要');
});
it('uses direct homepage ordering and automatically includes new categories with public articles', () => {
  const a = post('a', { editorial: { featured: true, weight: 20, relatedIds: [] }, categories: ['新分类'], termIds: { categories: ['new-category'], tags: [] } }), b = post('b', { editorial: { featured: true, weight: 10, relatedIds: [] } });
  expect(featuredEntries([a,b], ['b','a']).map(item => item.id)).toEqual(['b','a']);
  const release = { id: 'release', createdAt: '', label: '', entries: [a,b], types: [], settings: { ...defaultSettings, taxonomies: [], featuredOrder: ['b','a'] }, terms: [{ id: 'new-category', kind: 'category', label: '新分类', slug: 'new' }] } as Release;
  const catalog = newsletterCatalog(release);
  expect(catalog.featured.map(item => item.id)).toEqual(['b','a']);
  expect(catalog.categories).toMatchObject([{ id: 'new-category', count: 1, path: '/search/?category=new-category' }]);
  expect(pageMetadata({ ...a, description: entrySummary(a) }, release, new URL('http://localhost/a/')).description).toBe('正文第一段。');
});
it('carries structured sidebar and ads through settings validation and protects their media references', () => {
  const legacy = '<div>原广告与样式</div>';
  const settings = settingsSchema.parse({ ...defaultSettings, sidebar: { text: '支持创作', links: [{ label: '朋友', url: 'https://example.com' }] }, advertisements: { siteTop: { enabled: true, html: legacy, content: { title: '赞助商', text: '说明', image: '/media/ad.png', url: 'https://example.com' } } }, featuredOrder: ['b','a'] });
  expect(settings.advertisements!.siteTop!.html).toBe(legacy);
  expect(settings.sidebar!.links[0].label).toBe('朋友'); expect(settings.featuredOrder).toEqual(['b','a']);
  expect([...mediaReferencesIn(settings)]).toContain('/media/ad.png');
});
it('applies visual image focus to rendered responsive images without discarding existing styling', () => {
  const site = { store: { state: () => '1', get: () => ({ value: { width: 1200, height: 800, focalPoint: { x: 20, y: 75 }, derivatives: [{ url: '/media/small.webp', width: 640 }, { url: '/media/large.webp', width: 1200 }] } }) } } as any;
  const src = '/media/123456789012345678901234.png';
  expect(imageAttributes(site, src)).toMatchObject({ src: '/media/large.webp', style: 'object-position:20% 75%' });
  const html = responsiveImages(site, '<img src="' + src + '" style="border:0">');
  expect(html).toContain('border:0;object-position:20% 75%'); expect(html).toContain('srcset=');
});
