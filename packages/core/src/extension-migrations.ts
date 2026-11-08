import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { uuid } from '../../runtime-common/src/identity.ts';
import type { Extension } from './extensions.ts';
import type { Site } from './site.ts';

export async function migrateExtension(
  site: Site,
  ext: Extension,
  allowMigrations: boolean,
  onBackup: (path: string) => void,
) {
  const installed = site.store.get('extension-installed', ext.id),
    current = installed?.value.schemaVersion ?? 0,
    target = ext.schemaVersion ?? 0;
  if (current > target) throw new Error('扩展数据版本较新，不能使用旧版代码。');
  if (target > current && !allowMigrations && process.env.WEAVA_DATABASE_MODE !== 'migrate')
    throw new Error('扩展需要显式迁移，请执行 site update。');
  if (
    target > current &&
    process.env.WEAVA_MANAGED_UPDATE === '1' &&
    !Array.isArray(ext.migrationFiles)
  )
    throw new Error('自动升级需要声明 migrationFiles；仅数据库迁移声明空数组。');
  for (const file of ext.migrationFiles ?? [])
    if (!/^extensions\/state\/[\w./-]+$/.test(file) || file.split('/').includes('..'))
      throw new Error('扩展迁移文件必须是 extensions/state 内明确的相对文件。');
  for (let version = current + 1; version <= target; version++)
    if (!ext.migrations?.some((item) => item.version === version))
      throw new Error('缺少扩展迁移：' + version);
  let backup = installed?.value.backup;
  if (target > current) {
    const folder = join(site.root, 'archives', 'extension-upgrades');
    mkdirSync(folder, { recursive: true });
    backup = join(folder, ext.id + '-v' + current + '-to-v' + target + '-' + uuid() + '.sqlite');
    onBackup(backup);
    await site.store.raw.backup(backup);
  }
  site.store.raw
    .transaction(() => {
      for (let version = current + 1; version <= target; version++) {
        const result: unknown = ext
          .migrations!.find((item) => item.version === version)!
          .up({ site: site });
        if (result && typeof (result as any).then === 'function')
          throw new Error('扩展迁移必须同步完成，只写入事务内的站点数据。');
      }
      for (const type of ext.contentTypes ?? [])
        if (!site.store.get('type', type.id)) site.saveType(type, null);
      for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
        const row = site.store.get('extension-block', key),
          definition = ext.blockDefinitions?.[key];
        const value = {
          extension: ext.id,
          label: definition?.label ?? key,
          fields: definition?.fields ?? [],
        };
        if (JSON.stringify(row?.value) !== JSON.stringify(value))
          site.store.put('extension-block', key, value, row?.revision ?? null);
      }
      const value = {
        version: ext.version ?? '0.0.0',
        schemaVersion: target,
        ...(backup ? { backup } : {}),
      };
      if (JSON.stringify(installed?.value) !== JSON.stringify(value))
        site.store.put(
          'extension-installed',
          ext.id,
          value,
          installed?.revision ?? null,
          '扩展版本检查',
        );
    })
    .immediate();
}
