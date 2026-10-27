import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Site } from './site.ts';
import type { Entry, Release, ContentType, FieldDefinition, Block } from '@weava/contracts';
import { renderDocument } from './documents.ts';
import { renderBlocks } from './render.ts';
export interface Extension {
  id: string;
  apiVersion: 1;
  contentTypes?: ContentType[];
  themes?: { id: string; label: string }[];
  blocks?: Record<string, (block: Block, release: Release, entry?: Entry) => string>;
  panels?: { id: string; label: string; fields: FieldDefinition[] }[];
  schedules?: { id: string; intervalMs: number; run: () => Promise<void> }[];
  render?: (entry: Entry, release: Release) => Promise<string | null> | string | null;
  route?: (request: Request, release: Release | null) => Promise<Response | null>;
  start?: () => void;
  stop?: () => void;
}
const cache = new Map<string, Extension | null>();
export async function extension(
  site: Site,
  services: Record<string, any> = {},
): Promise<Extension | null> {
  if (cache.has(site.root)) return cache.get(site.root)!;
  const file = join(site.root, 'extensions', 'index.mjs');
  if (!existsSync(file)) {
    cache.set(site.root, null);
    return null;
  }
  const factory = (await import(pathToFileURL(file).href)).default;
  const ext: Extension = await factory({
    site,
    apiVersion: 1,
    renderDocument,
    renderBlocks,
    ...services,
  });
  if (ext.apiVersion !== 1) throw new Error('站点扩展 API 版本不兼容。');
  for (const type of ext.contentTypes ?? [])
    if (!site.store.get('type', type.id)) site.saveType(type, null);
  for (const key of Object.keys(ext.blocks ?? {})) {
    if (!key.startsWith(ext.id + ':')) throw new Error('扩展区块名称必须带扩展前缀。');
    site.store.put(
      'extension-block',
      key,
      { extension: ext.id },
      site.store.get('extension-block', key)?.revision ?? null,
    );
  }
  const timers = (ext.schedules ?? []).map((task) => {
    let running = false;
    const timer = setInterval(
      async () => {
        if (running) return;
        running = true;
        try {
          await task.run();
        } catch (error) {
          console.error('Extension task failed:', ext.id, task.id, error);
        } finally {
          running = false;
        }
      },
      Math.max(1000, task.intervalMs),
    );
    timer.unref();
    return timer;
  });
  cache.set(site.root, ext);
  ext.start?.();
  process.once('exit', () => {
    timers.forEach(clearInterval);
    ext.stop?.();
  });
  return ext;
}
