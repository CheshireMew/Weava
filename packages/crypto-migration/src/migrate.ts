import { WeavaError } from '@weava/contracts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from '../../runtime-common/src/files.ts';
import { now } from '../../runtime-common/src/identity.ts';
import { importCryptoAnalytics } from './crypto-migration-analytics.ts';
import {
  archiveCryptoAssets,
  prepareCryptoMedia,
  registerCryptoMedia,
} from './crypto-migration-assets.ts';
import {
  importCryptoHiddenContent,
  importCryptoPublicContent,
  restoreCryptoDrafts,
} from './crypto-migration-content.ts';
import { installCryptoExtension } from './crypto-migration-extension.ts';
import { importCryptoHistory } from './crypto-migration-history.ts';
import {
  cryptoEntryWriter,
  importCryptoSettings,
  type MigratedEntry,
  type MigrationIssue,
} from './crypto-migration-records.ts';
import { prepareCryptoMigration } from './crypto-migration-source.ts';
import { withInstanceMaintenance } from '../../core/src/instance-access.ts';
import { Site } from '../../core/src/site.ts';

export async function migrateCrypto(
  source: string,
  target: string,
  capture: string,
  dryRun = false,
) {
  const input = prepareCryptoMigration(source, target, capture, dryRun);
  const { plan } = input;
  if (dryRun) return { ...plan, dryRun: true };
  return withInstanceMaintenance(target, async () => {
    const site = new Site(target);
    const imported: MigratedEntry[] = [],
      conflicts: MigrationIssue[] = [],
      compatibility: { id: string; path: string; mode: string }[] = [];
    mkdirSync(join(target, 'imports'), { recursive: true });
    try {
      importCryptoSettings(site, input, conflicts);
      const put = cryptoEntryWriter(site, imported, conflicts);
      importCryptoPublicContent(input, put, compatibility);
      prepareCryptoMedia(input);
      if (conflicts.length) throw new WeavaError('目标存在修改，迁移停止发布。', 409, conflicts);
      await installCryptoExtension(site, target);
      if (imported.some((item) => !item.unchanged))
        site.publish({ label: '从加密网站迁移公开版本' });
      restoreCryptoDrafts(site, input, put);
      archiveCryptoAssets(input);
      const historyCount = importCryptoHistory(site, input, conflicts);
      await importCryptoAnalytics(source, target);
      importCryptoHiddenContent(site, input);
      registerCryptoMedia(site, input);
      atomicJson(join(target, 'site.json'), { version: 1, port: 4323 });
      const report = {
        ...plan,
        imported,
        compatibility,
        conflicts,
        historyCount,
        completedAt: now(),
        sourceUnchanged: true,
      };
      atomicJson(join(target, 'imports/migration-report.json'), report);
      return {
        ...plan,
        imported: imported.length,
        compatibility: compatibility.length,
        historyCount,
        conflicts,
      };
    } finally {
      site.close();
    }
  });
}
