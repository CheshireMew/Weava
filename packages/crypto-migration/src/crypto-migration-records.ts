import { defaultSettings, type Entry, type Settings } from '@weava/contracts';
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CryptoMigrationSource } from './crypto-migration-source.ts';
import type { Site } from '../../core/src/site.ts';
export type MigrationIssue = {
  id?: string;
  path?: string;
  file?: string;
  reason?: string;
  error?: string;
};
export type MigratedEntry = { id: string; path: string; revision?: number; unchanged?: boolean };
export function importCryptoSettings(
  site: Site,
  input: CryptoMigrationSource,
  conflicts: MigrationIssue[],
) {
  const { publicRoot, config, catalog } = input;
  for (const [id, label, prefix] of [
    ['post', '原创文章', '/guides/'],
    ['source', '来源资料', '/learn/'],
  ])
    if (!site.store.get('type', id))
      site.saveType({ id, label, pathPrefix: prefix, template: 'article', fields: [] }, null);
  const nav = load(readFileSync(join(publicRoot, 'index.html'), 'utf8'))('nav#main-nav a')
    .toArray()
    .map((a) => ({ label: load(a).text(), url: load(a)('a').attr('href') ?? '/' }));
  const settings: Settings = {
    ...defaultSettings,
    name: config.name,
    domain: config.domain,
    language: config.language,
    theme: 'crypto-blacknico',
    themeConfig: {
      ...defaultSettings.themeConfig,
      accent: '#536940',
      background: '#f6f8f3',
      width: 1280,
    },
    navigation: nav,
    description: '加密学习资料与原创指南',
    taxonomies: catalog.categories.map((c: any) => ({
      id: c.slug,
      label: c.name,
      description: c.description,
    })),
    extensions: { crypto: { config } },
    footer: '© BlackNico · 独立学习资料站',
  };
  const settingsMark = site.store.get('import', 'settings');
  if (!settingsMark || site.settings().revision === settingsMark.value.targetRevision) {
    const saved = site.saveSettings(settings, site.settings().revision);
    site.store.put(
      'import',
      'settings',
      { targetRevision: saved.revision },
      settingsMark?.revision ?? null,
    );
  } else conflicts.push({ id: 'settings', reason: '目标设置已被编辑' });
}
export function cryptoEntryWriter(
  site: Site,
  imported: MigratedEntry[],
  conflicts: MigrationIssue[],
) {
  const put = (value: Entry, sourceHash: string) => {
    const marker = site.store.get('import', value.id),
      existing = site.store.get('entry', value.id);
    if (existing && marker?.value.targetRevision !== existing.revision) {
      conflicts.push({ id: value.id, path: value.path, reason: '目标已被编辑' });
      return;
    }
    if (marker?.value.hash === sourceHash) {
      imported.push({ id: value.id, unchanged: true, path: value.path });
      return;
    }
    const saved = site.saveEntry(value, existing?.revision ?? null);
    site.store.put(
      'import',
      value.id,
      { hash: sourceHash, targetRevision: saved.revision },
      marker?.revision ?? null,
    );
    imported.push({ id: value.id, path: value.path, revision: saved.revision });
  };
  return put;
}
export type CryptoEntryWriter = ReturnType<typeof cryptoEntryWriter>;
