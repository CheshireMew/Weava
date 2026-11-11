import { entrySchema, type Entry, type Release, type Settings } from '@weava/contracts';
import type { Site } from './site.ts';
import { prepareEntryCandidate } from './content-validation.ts';
import { entrySummary, recommendedEntries } from './editorial.ts';
import { renderBlocks } from './render.ts';
import type { ExtensionManager } from './extension-manager.ts';

export async function previewSeo(site: Site, manager: ExtensionManager, input: {
  entry?: Entry;
  settings?: Pick<Settings, 'domain' | 'name' | 'description' | 'seo'>;
  type?: string;
}) {
  const current = site.visibleRelease();
  const settings = { ...site.settings().value, ...input.settings };
  const types = site.store.list('type').map(row => row.value);
  const type = types.find(item => item.id === input.type) ?? types[0];
  const release: Release = {
    id: current?.id ?? 'draft', createdAt: current?.createdAt ?? new Date().toISOString(), label: current?.label ?? '',
    ...current, settings, types: input.entry || input.type ? types : types.map(item => ({ ...item, seoTemplates: undefined })),
    entries: current?.entries ?? [],
  };
  const entry = input.entry ? prepareEntryCandidate(site, input.entry, { required: false }) : entrySchema.parse({
    id: 'seo-template-sample', path: '/example-article/', kind: type ? 'content' : 'page',
    type: type?.id, template: type?.template, title: '如何整理一篇长文', description: '从拟定提纲到校对引用，整理一篇便于阅读和复查的长文。', author: '示例作者',
  });
  if (!entry.description) {
    const render = (blocks: Entry['blocks']) => renderBlocks(blocks, release, entry, manager.blocks);
    entry.description = entrySummary(entry, entry.blocks.length ? render(entry.blocks) : undefined, render);
  }
  return manager.metadata(entry, release, new URL(entry.path, settings.domain));
}

export function internalLinkSuggestions(site: Site, id: string, context: string) {
  const release = site.visibleRelease();
  const source = site.store.get('entry', id)?.value as Entry | undefined;
  if (!release || !source) return [];
  const segment = new Intl.Segmenter(release.settings.language, { granularity: 'word' });
  const words = (value: string) => new Set([...segment.segment(value.toLowerCase())].filter(item => item.isWordLike && item.segment.length > 1).map(item => item.segment));
  const query = words(context);
  const ranked = release.entries.filter(entry => entry.id !== id && entry.visibility !== 'private' && entry.indexable).flatMap(entry => {
    const titleWords = words(entry.title), descriptionWords = words(entry.description);
    const titleMatches = [...query].filter(word => titleWords.has(word));
    const descriptionMatches = [...query].filter(word => descriptionWords.has(word));
    const score = titleMatches.length * 3 + descriptionMatches.length;
    return score ? [{ entry, score, reason: titleMatches.length ? '标题匹配所选文字' : '摘要匹配所选文字' }] : [];
  }).sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, release.settings.language));
  const candidates = ranked.slice(0, 5);
  if (!candidates.length) for (const entry of recommendedEntries(source, release, 5)) {
    const related = source.editorial?.relatedIds?.includes(entry.id) || source.categories.some(category => entry.categories.includes(category)) || source.tags.some(tag => entry.tags.includes(tag));
    if (related) candidates.push({ entry, score: 0, reason: '与当前文章相关' });
  }
  return candidates.map(({ entry, reason }) => ({ id: entry.id, title: entry.title, path: entry.path, description: entry.description, reason }));
}
