import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { Site, extension } from '@weava/core';
import { convertCryptoLibrary } from './library.ts';
import { installCryptoSource } from './crypto-source.ts';

export async function convertCryptoSite(
  sourcePath: string,
  targetPath = sourcePath,
  options: { apply?: boolean; dryRun?: boolean; backupRoot?: string } = {},
) {
  const framework = process.env.WEAVA_FRAMEWORK ?? resolve(import.meta.dirname, '../../..');
  const source = resolve(sourcePath),
    target = resolve(targetPath),
    apply = options.apply ?? false;
  const checkpointRoot = options.backupRoot ?? join(target, 'archives/library-migration');
  if (source !== target) process.env.WEAVA_RESOURCE_ROOT = source;
  if (existsSync(join(target, 'weava.sqlite')) && !apply)
    throw new Error('目标已有数据库；仅明确 --apply 时修改已有站点。');
  if (source === target && !apply)
    throw new Error('原站迁移需要 --apply，且必须先通过管理入口停站。');
  if (source === target && existsSync(join(target, 'runtime.json'))) {
    const state = JSON.parse(readFileSync(join(target, 'runtime.json'), 'utf8'));
    if (state.status === 'running') {
      try {
        process.kill(state.pid, 0);
        throw new Error('请先通过 site stop 停站。');
      } catch (error: any) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  const input = new Database(join(source, 'weava.sqlite'), { readonly: true, fileMustExist: true });
  const rows = (scope: string) =>
    input
      .prepare('SELECT data FROM records WHERE scope=?')
      .all(scope)
      .map((row: any) => JSON.parse(row.data));
  const entries = rows('entry'),
    types = rows('type'),
    settings = rows('settings')[0];
  const converted = convertCryptoLibrary(entries, settings, types);
  if (options.dryRun) {
    input.close();
    return {
      source,
      target,
      entries: converted.entries.length,
      pages: converted.entries.filter((e) => e.kind === 'page').length,
      theme: converted.settings.theme,
    };
  }
  if (source === target && settings.theme === 'library' && !entries.some((e) => e.compatibility)) {
    input.close();
    return { target, unchanged: true };
  }
  mkdirSync(target, { recursive: true });
  const folder = join(target, 'extensions'),
    templates = join(folder, 'templates');
  mkdirSync(templates, { recursive: true });
  const assets = join(folder, 'assets');
  mkdirSync(assets, { recursive: true });
  for (const name of ['equity-logos', 'og.png', 'og.svg', 'brand.png'])
    if (existsSync(join(source, 'themes/crypto', name)))
      cpSync(join(source, 'themes/crypto', name), join(assets, name), { recursive: true });
  mkdirSync(join(target, 'imports'), { recursive: true });
  mkdirSync(join(target, 'public'), { recursive: true });
  const existingSource = source === target && existsSync(join(folder, 'crypto-src'));
  if (source === target) {
    mkdirSync(checkpointRoot, { recursive: true });
    const backup = join(checkpointRoot, 'before.sqlite');
    if (!existsSync(backup)) await input.backup(backup);
    copyFileSync(join(folder, 'index.ts'), join(checkpointRoot, 'before-extension.ts'));
    copyFileSync(join(folder, 'index.mjs'), join(checkpointRoot, 'before-extension.mjs'));
    if (existingSource)
      cpSync(join(folder, 'crypto-src'), join(checkpointRoot, 'before-crypto-src'), {
        recursive: true,
      });
  }
  let site: Site | undefined;
  try {
    for (const [name, data] of Object.entries(converted.assets))
      writeFileSync(join(name.endsWith('.html') ? templates : join(target, 'public'), name), data);
    for (const name of [
      'video-sources.json',
      'exchange-announcements.json',
      'equity-catalog.json',
      'equity-rules.json',
      'public-stock-snapshot.json',
    ])
      if (source !== target && existsSync(join(source, 'imports', name)))
        copyFileSync(join(source, 'imports', name), join(target, 'imports', name));
    for (const name of ['favicon.svg'])
      if (existsSync(join(source, 'themes/crypto', name)))
        copyFileSync(join(source, 'themes/crypto', name), join(target, 'public', name));
    const extensionSource = join(framework, 'packages/crypto-extension/src');
    const program = process.env.WEAVA_PROGRAM_ROOT;
    const sourceBuild = existsSync(join(extensionSource, 'index.ts'));
    if (sourceBuild) installCryptoSource(extensionSource, folder, 'index');
    else if (program) {
      copyFileSync(join(program, 'runtime/crypto-extension.mjs'), join(folder, 'index.mjs'));
      installCryptoSource(join(program, 'runtime/crypto-assets'), folder, 'index');
    } else throw new Error('缺少 Crypto 业务扩展构建。');
    const extensionAssets = sourceBuild ? extensionSource : join(program!, 'runtime/crypto-assets');
    copyFileSync(join(extensionAssets, 'browser.js'), join(templates, 'crypto-business.js'));
    copyFileSync(join(extensionAssets, 'announcements.js'), join(templates, 'announcements.js'));
    for (const name of ['equities.css', 'equities.js'])
      if (existsSync(join(source, 'themes/crypto', name)))
        copyFileSync(join(source, 'themes/crypto', name), join(templates, name));
    if (sourceBuild)
      await build({
        entryPoints: [join(folder, 'index.ts')],
        outfile: join(folder, 'index.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        nodePaths: [join(framework, 'node_modules')],
        banner: {
          js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);',
        },
      });
    site = new Site(target, { mode: 'migrate' });
    const activeSite = site;
    const ext = await extension(site, {}, { mode: 'worker' });
    if (ext.status().some((e) => e.status !== 'active'))
      throw new Error(JSON.stringify(ext.status()));
    const release = site.store.raw
      .transaction(() => {
        for (const type of converted.types) {
          const previous = activeSite.store.get('type', type.id);
          activeSite.saveType(type, previous?.revision ?? null, converted.entries);
        }
        activeSite.saveSettings(converted.settings, activeSite.settings().revision);
        for (const entry of converted.entries) {
          const previous = activeSite.store.get('entry', entry.id);
          if (JSON.stringify(previous?.value) !== JSON.stringify(entry))
            activeSite.saveEntry(entry, previous?.revision ?? null);
        }
        if (source !== target)
          for (const media of rows('media'))
            if (!activeSite.store.get('media', media.id))
              activeSite.store.put('media', media.id, media, null);
        return activeSite.publish({ label: '资料库主题：动态栏目与独立业务扩展' });
      })
      .immediate();
    if (!existsSync(join(target, 'site.json')))
      writeFileSync(
        join(target, 'site.json'),
        JSON.stringify(
          {
            version: 2,
            id: 'library-review',
            port: 4338,
            template: 'blank',
            features: ['content', 'media', 'analytics', 'engagement'],
          },
          null,
          2,
        ),
      );
    return {
      target,
      release: release.id,
      entries: converted.entries.length,
      pages: converted.entries.filter((e) => e.kind === 'page').length,
      assets: Object.keys(converted.assets),
      extensions: ext.status(),
    };
  } catch (error) {
    if (source === target)
      for (const [saved, file] of [
        ['before-extension.ts', 'index.ts'],
        ['before-extension.mjs', 'index.mjs'],
      ])
        if (existsSync(join(checkpointRoot, saved)))
          copyFileSync(join(checkpointRoot, saved), join(folder, file));
    if (existingSource)
      cpSync(join(checkpointRoot, 'before-crypto-src'), join(folder, 'crypto-src'), {
        recursive: true,
      });
    throw error;
  } finally {
    site?.close();
    input.close();
  }
}
