import { join } from 'node:path';
import { parse as yaml } from 'yaml';
import { walk } from '../../runtime-common/src/files.ts';
import { digest, now } from '../../runtime-common/src/identity.ts';
import type { MigrationIssue } from './crypto-migration-records.ts';
import { read, type CryptoMigrationSource } from './crypto-migration-source.ts';
import type { Site } from '../../core/src/site.ts';
export function importCryptoHistory(
  site: Site,
  input: CryptoMigrationSource,
  conflicts: MigrationIssue[],
) {
  const { source } = input;
  const sourceDoc = (source: string) => ({
    version: 1 as const,
    format: 'markdown' as const,
    source,
  });
  // Import authoring histories as native read-only revisions, retaining originals too.
  let historyCount = 0;
  for (const file of walk(join(source, '.cms/versions')).filter((f) => f.endsWith('.json'))) {
    const item = read(file);
    if (!item?.markdown) continue;
    try {
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(item.markdown);
      if (!match) continue;
      const meta = yaml(match[1]),
        entry = site.store.get('entry', meta.id);
      if (!entry) continue;
      const mark = 'history:' + digest(file);
      if (site.store.get('import', mark)) continue;
      const v = {
        ...entry.value,
        title: meta.title,
        description: meta.description,
        document: sourceDoc(match[2]),
      };
      site.store.raw
        .prepare('INSERT INTO revisions(scope,id,data,created_at,label) VALUES(?,?,?,?,?)')
        .run(
          'entry',
          meta.id,
          JSON.stringify(v),
          item.created ?? now(),
          '迁移历史：' + (item.label ?? ''),
        );
      site.store.put('import', mark, { source: file }, null);
      historyCount++;
    } catch (error) {
      conflicts.push({ file, error: String(error) });
    }
  }
  return historyCount;
}
