import type { Site } from './site.ts';
import type { Entry, Release, ContentType, FieldDefinition, Block, BlockDefinition } from '@weava/contracts';
import { ExtensionManager } from './extension-manager.ts';
import type { MetadataContribution } from './seo.ts';
export * from './extension-manager.ts';
export interface Extension {
  id: string;
  apiVersion: 1;
  version?: string;
  label?: string;
  dependencies?: { id: string; minVersion?: string }[];
  schemaVersion?: number;
  migrations?: { version: number; up: (context: { site: Site }) => void }[];
  contentTypes?: ContentType[];
  themes?: { id: string; label: string }[];
  blocks?: Record<string, (block: Block, release: Release, entry?: Entry) => string>;
  blockDefinitions?: Record<string, BlockDefinition>;
  panels?: { id: string; label: string; fields: FieldDefinition[] }[];
  schedules?: { id: string; intervalMs: number; run: () => Promise<void> }[];
  render?: (entry: Entry, release: Release) => Promise<string | null> | string | null;
  metadata?: (entry: Entry, release: Release, url: URL) => Promise<MetadataContribution | null> | MetadataContribution | null;
  route?: (request: Request, release: Release | null) => Promise<Response | null>;
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
}
const cache = new WeakMap<Site, Promise<ExtensionManager>>();
export async function extension(
  site: Site,
  services: Record<string, any> = {},
  options: { mode?: 'runtime' | 'worker' } = {},
): Promise<ExtensionManager> {
  let manager = cache.get(site);
  if (!manager) { manager = ExtensionManager.open(site, services, options.mode ?? 'runtime'); cache.set(site, manager); }
  return manager;
}
