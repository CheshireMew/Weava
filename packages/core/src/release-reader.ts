import type Database from 'better-sqlite3';
import type { Release } from '@weava/contracts';
export function loadRelease(db: Database.Database, raw: string): Release {
  const data = JSON.parse(raw);
  if (data.storageVersion !== 2) return data as Release;
  const read = db.prepare('SELECT data FROM publication_objects WHERE key=?');
  const get = (key: string) => {
    const row = read.get(key) as { data: string } | undefined;
    if (!row) throw new Error('公开版本引用的数据不存在：' + key);
    return JSON.parse(row.data);
  };
  return {
    id: data.id,
    createdAt: data.createdAt,
    label: data.label,
    entries: data.entryKeys.map(get),
    settings: get(data.settingsKey),
    types: get(data.typesKey),
    redirects: get(data.redirectsKey),
    terms: data.termsKey ? get(data.termsKey) : [],
    ...(data.layoutsKey ? { layouts: get(data.layoutsKey) } : {}),
  };
}
