import { contentViews, creationTemplates } from './authoring.ts';
import type { ExtensionManager } from './extension-manager.ts';
import type { Extension } from './extensions.ts';
import { layouts } from './layouts.ts';
import { imageAttributes } from './media-display.ts';
import { programStatus } from './programs.ts';
import { publicationPlans } from './publication-plans.ts';
import { schedules } from './schedules.ts';
import { SCHEMA_VERSION } from './schema-version.ts';
import { settingsPublicationState } from './settings-state.ts';
import { siteFeatures } from './site-features.ts';
import type { Site } from './site.ts';
export function adminState(
  site: Site,
  extension: Pick<ExtensionManager, 'themes' | 'panels' | 'blocks' | 'blockDefinitions' | 'status'>,
  options: { panel?: string | null; summary: boolean; entryId?: string | null },
) {
  const settings = site.settings();
  const settingsPanel = ['appearance', 'comments'].includes(options.panel ?? '');
  const published = settingsPanel ? site.release() : null;
  return {
    settings,
    siteIcon: imageAttributes(site, settings.value.logo, 64).src,
    features: siteFeatures(site.root),
    ...(settingsPanel
      ? settingsPublicationState(
          settings.value,
          site.terms().map((row) => row.value),
          published,
        )
      : {}),
    ...(options.panel === 'appearance' ? { siteInfo: settings.value.siteInfo } : {}),
    types: site.entryStore.types(),
    contentViews: contentViews(site),
    creationTemplates: creationTemplates(site),
    terms: site.terms(),
    authors: site.entryStore.authors(),
    layouts: layouts(site),
    schedules: options.summary
      ? options.entryId
        ? schedules(site, options.entryId!)
        : []
      : schedules(site),
    publicationPlans: options.summary ? [] : publicationPlans(site),
    entries: options.summary ? [] : site.entries(),
    entryCount: { n: site.entryStore.count() },
    media: options.summary ? [] : site.media.list(),
    jobs: options.summary ? (options.panel === 'operations' ? site.jobs(true) : []) : site.jobs(),
    releases: options.summary
      ? options.panel === 'operations'
        ? site.publication.recent(20)
        : []
      : site.releases(),
    themes: [
      { id: 'weava', label: 'Weava' },
      { id: 'newsletter', label: 'Newsletter' },
      { id: 'library', label: '资料库' },
      ...(extension?.themes ?? []),
    ],
    extensionPanels: [
      {
        id: 'library',
        label: '资料库',
        themes: ['library'],
        fields: [
          { key: 'brandTitle', label: '品牌名称', type: 'text' },
          { key: 'brandSubtitle', label: '品牌署名', type: 'text' },
          { key: 'favicon', label: '网站图标', type: 'media' },
          {
            key: 'footerLinks',
            label: '页脚链接',
            type: 'group',
            multiple: true,
            summaryField: 'label',
            fields: [
              { key: 'label', label: '名称', type: 'text' },
              { key: 'url', label: '网址', type: 'text' },
            ],
          },
        ],
      } satisfies NonNullable<Extension['panels']>[number],
      ...(extension?.panels ?? []),
    ],
    fieldWidgets: site.fieldWidgets,
    extensionBlocks: Object.keys(extension?.blocks ?? {}),
    extensionBlockDefinitions: Object.fromEntries(
      Object.entries(extension.blockDefinitions).map(([key, value]) => [
        key,
        { label: value.label, fields: value.fields.map((field) => ({ ...field })) },
      ]),
    ),
    extensions: extension.status(),
    program: { ...programStatus(site.root), databaseSchema: SCHEMA_VERSION },
  };
}
