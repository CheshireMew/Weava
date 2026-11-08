import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walk } from '../../runtime-common/src/files.ts';
import { digest } from '../../runtime-common/src/identity.ts';
import { read, type CryptoMigrationSource } from './crypto-migration-source.ts';
import type { Site } from '../../core/src/site.ts';
export function prepareCryptoMedia(input: CryptoMigrationSource) {
  const { source, target, publicRoot } = input;
  // Public and unpublished media must exist before publication validation.
  for (const file of walk(join(source, 'public/media')).filter(
    (f) => !/\.(mp4|m4v|mov|webm)$/i.test(f),
  )) {
    const destination = join(target, 'media', relative(join(source, 'public/media'), file));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    if (!existsSync(destination)) copyFileSync(file, destination);
  }
  for (const file of walk(join(publicRoot, 'media'))) {
    const destination = join(target, 'media', relative(join(publicRoot, 'media'), file));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    if (!existsSync(destination)) copyFileSync(file, destination);
  }
}
export function archiveCryptoAssets(input: CryptoMigrationSource) {
  const { source, target, publicRoot, capture } = input;
  // Copy actual runtime assets. Videos remain remote references; no hard links to the source.
  for (const file of walk(publicRoot).filter(
    (f) => !f.endsWith('index.html') && !/\.(mp4|m4v|mov|webm)$/i.test(f),
  )) {
    const relativePath = relative(publicRoot, file);
    const destination = relativePath.startsWith('media')
      ? join(target, relativePath)
      : join(target, 'themes/crypto', relativePath);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    if (
      !existsSync(destination) ||
      digest(readFileSync(destination)) !== digest(readFileSync(file))
    )
      copyFileSync(file, destination);
  }
  const archiveFiles = [
    ...walk(join(source, 'content')),
    ...walk(join(source, '.cms/versions')),
    ...walk(join(source, '.cms/management')),
  ].filter((f) => !f.endsWith('.pyc'));
  for (const file of archiveFiles) {
    const destination = join(target, 'imports/legacy', relative(source, file));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    if (!existsSync(destination)) copyFileSync(file, destination);
  }
  for (const name of [
    'video-sources.json',
    'exchange-announcements.json',
    'equity-catalog.json',
    'link-overrides.json',
  ]) {
    const file = join(source, 'content', name);
    if (existsSync(file)) copyFileSync(file, join(target, 'imports', name));
  }
  if (existsSync(join(capture, 'equity-rules.json')))
    copyFileSync(join(capture, 'equity-rules.json'), join(target, 'imports/equity-rules.json'));
  copyFileSync(
    join(publicRoot, 'equity-catalog.json'),
    join(target, 'imports/public-stock-snapshot.json'),
  );
}
export function registerCryptoMedia(site: Site, input: CryptoMigrationSource) {
  const { source, target } = input;
  // Register migrated attachments without regenerating already prepared derivatives.
  const mediaMetadata = read(join(source, 'content/media-metadata.json'), { images: {} });
  for (const file of walk(join(target, 'media')).filter(
    (f) => relative(join(target, 'media'), f).split(/[\\/]/).length === 1,
  )) {
    const id = digest(relative(join(target, 'media'), file)).slice(0, 24);
    if (site.store.get('media', id)) continue;
    const data = readFileSync(file),
      name = relative(join(target, 'media'), file),
      metadata = mediaMetadata.images?.[name] ?? {};
    site.store.put(
      'media',
      id,
      {
        id,
        name,
        url: '/media/' + encodeURIComponent(name),
        bytes: data.length,
        hash: digest(data),
        ...metadata,
        imported: true,
      },
      null,
      '迁移媒体',
    );
  }
}
