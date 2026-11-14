import type { Site } from './site.ts';
import type { Entry, Release, ContentType, FieldDefinition, Block, BlockDefinition } from '@weava/contracts';
import { ExtensionManager } from './extension-manager.ts';
import type { MetadataContribution } from './seo.ts';
import type { FieldWidget } from '@weava/contracts';
export * from './extension-manager.ts';
export interface Extension {
  id: string;
  apiVersion: 1;
  version?: string;
  label?: string;
  dependencies?: { id: string; minVersion?: string }[];
  schemaVersion?: number;
  migrations?: { version: number; up: (context: { site: Site }) => void }[];
  /** Managed updates require [] for database-only migrations, or exact extension state files. */
  migrationFiles?: string[];
  jobs?: Record<string, (payload: unknown) => Promise<unknown> | unknown>;
  contentTypes?: ContentType[];
  themes?: { id: string; label: string }[];
  fieldWidgets?: Record<string, FieldWidget>;
  blocks?: Record<string, (block: Block, release: Release, entry?: Entry) => string>;
  blockDefinitions?: Record<string, BlockDefinition>;
  panels?: { id: string; label: string; themes?: string[]; fields: FieldDefinition[] }[];
  schedules?: { id: string; intervalMs: number; run: () => Promise<void> }[];
  render?: (entry: Entry, release: Release) => Promise<string | null> | string | null;
  transformHtml?: (html: string, release: Release, url: URL) => string | Promise<string>;
  metadata?: (entry: Entry, release: Release, url: URL) => Promise<MetadataContribution | null> | MetadataContribution | null;
  route?: (request: Request, release: Release | null) => Promise<Response | null>;
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
}
const cache = new WeakMap<Site, Promise<ExtensionManager>>();
export async function extension(
  site: Site,
  services: Record<string, any> = {},
  options: { mode?: 'runtime' | 'worker'; migrate?: boolean; startPaused?:boolean } = {},
): Promise<ExtensionManager> {
  const previous = cache.get(site);
  if(previous) {
    const manager=await previous;
    if(!manager.isStopped)return manager;
    if(cache.get(site)!==previous)return extension(site,services,options);
  }
  const manager=ExtensionManager.open(site,services,options.mode??'runtime',options.migrate??false,options.startPaused??false);
  cache.set(site,manager);
  try{return await manager;}
  catch(error){if(cache.get(site)===manager)cache.delete(site);throw error;}
}
