import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../../runtime-common/src/files.ts';
import { digest } from '../../runtime-common/src/identity.ts';
import { Analytics } from '../../core/src/analytics.ts';
export async function importCryptoAnalytics(source: string, target: string) {
  const analytics = new Analytics(target);
  try {
    for (const file of walk(join(source, '.cms/analytics')).filter((f) =>
      /\.(sqlite3|sqlite|db)$/.test(f),
    )) {
      const dest = join(target, 'imports', 'statistics-' + digest(file).slice(0, 12) + '.sqlite');
      if (!existsSync(dest)) {
        const db = new Database(file, { readonly: true });
        try {
          await db.backup(dest);
        } finally {
          db.close();
        }
      }
      analytics.raw
        .prepare('INSERT OR REPLACE INTO legacy_sources VALUES(?,?,?)')
        .run(digest(file), dest, JSON.stringify({ source: file }));
      const old = new Database(dest, { readonly: true });
      try {
        const insert = analytics.raw.prepare(
            'INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          ),
          sourceId = 'legacy:' + digest(file).slice(0, 12) + ':';
        analytics.raw.transaction(() => {
          for (const row of old.prepare('SELECT * FROM views').all() as any[])
            insert.run(
              sourceId + row.id,
              'view',
              new Date(row.ts).toISOString(),
              row.path,
              row.visitor,
              row.session,
              '',
              '',
              '',
              row.referrer ?? '',
              'legacy',
            );
          for (const row of old
            .prepare('SELECT c.*,v.visitor FROM clicks c LEFT JOIN views v ON v.id=c.view_id')
            .all() as any[])
            insert.run(
              sourceId + row.id,
              'click',
              new Date(row.ts).toISOString(),
              row.path,
              row.visitor ?? '',
              row.session ?? '',
              row.url,
              row.label,
              row.zone,
              '',
              'legacy',
            );
        })();
      } finally {
        old.close();
      }
    }
  } finally {
    analytics.close();
  }
}
