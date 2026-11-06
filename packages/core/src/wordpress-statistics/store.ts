import Database from 'better-sqlite3';
import { join } from 'node:path';
import { normalizePath } from '../paths.ts';

export const hasHistory = (db: Database.Database) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wp_statistics_sources'")
    .get();

export function activeSource(db: Database.Database, sourceId: string) {
  return hasHistory(db)
    ? (db.prepare('SELECT * FROM wp_statistics_sources WHERE source_id=?').get(sourceId) as any)
    : undefined;
}

export function database(root: string, name: string) {
  return new Database(join(root, name), { readonly: true, fileMustExist: true });
}

export function pagePath(uri: string) {
  try {
    return normalizePath(new URL(uri || '/', 'https://placeholder.invalid').pathname);
  } catch {
    return null;
  }
}
