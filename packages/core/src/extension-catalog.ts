import { blockTypes, typeSchema, VERSION, WeavaError } from '@weava/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { renderDocument } from './documents.ts';
import type { Extension } from './extensions.ts';
import { queryEntries } from './query.ts';
import { renderBlocks } from './render.ts';
import { metadataHead } from './seo.ts';
import type { Site } from './site.ts';

import { inside } from '../../runtime-common/src/paths.ts';
import { pageMetadata } from './seo.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const extensionManifestSchema = z.object({
  version: z.literal(1),
  extensions: z.array(
    z.object({
      id: identifier,
      file: z.string().endsWith('.mjs'),
      enabled: z.boolean().default(true),
    }),
  ),
});
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const compareVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
export interface ExtensionMember {
  id: string;
  file: string;
  enabled: boolean;
  extension?: Extension;
  error?: string;
}
export interface ExtensionDiagnostic {
  id: string;
  label: string;
  version: string;
  enabled: boolean;
  status: 'active' | 'disabled' | 'failed' | 'blocked';
  error?: string;
  dependencies: { id: string; minVersion?: string }[];
  schemaVersion: number;
  installedSchema: number;
  configRevision: number | null;
  backup?: string;
  taskError?: string;
}
export async function loadExtensions(
  site: Site,
  services: Record<string, unknown>,
): Promise<ExtensionMember[]> {
  const members: ExtensionMember[] = [];
  let folder = join(site.root, 'extensions');
  const pointer = join(site.root, 'program.json');
  if (existsSync(pointer)) {
    const selected = JSON.parse(readFileSync(pointer, 'utf8'));
    if (selected.siteBuildId) {
      const build = inside(
          process.env.WEAVA_SITE_BUILDS_ROOT ?? join(site.root, 'site-builds'),
          selected.siteBuildId,
        ),
        manifestFile = join(build, 'site-build.json');
      const descriptor = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (descriptor.extensions) folder = inside(build, descriptor.extensions);
    }
  }
  const manifest = join(folder, 'manifest.json');
  let descriptors: { id?: string; file: string; enabled: boolean }[];
  try {
    descriptors = existsSync(manifest)
      ? extensionManifestSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))).extensions
      : existsSync(join(folder, 'index.mjs'))
        ? [{ file: 'index.mjs', enabled: true }]
        : [];
    const seen = new Set<string>();
    for (const descriptor of descriptors) {
      if (descriptor.id && seen.has(descriptor.id))
        throw new WeavaError('扩展清单编号重复：' + descriptor.id);
      if (descriptor.id) seen.add(descriptor.id);
    }
  } catch (error: any) {
    return [
      { id: 'manifest', file: manifest, enabled: true, error: '扩展清单无效：' + error.message },
    ];
  }
  for (const descriptor of descriptors) {
    const member: ExtensionMember = {
      id: descriptor.id ?? 'legacy',
      file: descriptor.file,
      enabled: descriptor.enabled,
    };
    members.push(member);
    try {
      const file = inside(folder, descriptor.file);
      const factory = (await import(/* @vite-ignore */ pathToFileURL(file).href)).default;
      if (typeof factory !== 'function') throw new Error('扩展需要默认导出工厂函数。');
      const ext: Extension = await factory({
        site: site,
        apiVersion: 1,
        frameworkVersion: VERSION,
        renderDocument,
        renderBlocks,
        pageMetadata,
        metadataHead,
        queryEntries,
        z,
        ...services,
      });
      identifier.parse(ext.id);
      if (descriptor.id && ext.id !== descriptor.id) throw new Error('扩展编号与清单不一致。');
      member.id = ext.id;
      if (ext.apiVersion !== 1) throw new Error('扩展 API 版本不兼容。');
      versionSchema.parse(ext.version ?? '0.0.0');
      for (const dependency of ext.dependencies ?? []) {
        identifier.parse(dependency.id);
        if (dependency.minVersion) versionSchema.parse(dependency.minVersion);
      }
      if (!Number.isSafeInteger(ext.schemaVersion ?? 0) || (ext.schemaVersion ?? 0) < 0)
        throw new Error('扩展数据版本无效。');
      const migrations = ext.migrations ?? [],
        versions = new Set<number>();
      for (const migration of migrations) {
        if (
          !Number.isSafeInteger(migration.version) ||
          migration.version < 1 ||
          migration.version > (ext.schemaVersion ?? 0) ||
          versions.has(migration.version) ||
          typeof migration.up !== 'function' ||
          migration.up.constructor.name === 'AsyncFunction'
        )
          throw new Error('扩展迁移编号无效、重复或使用了异步函数。');
        versions.add(migration.version);
      }
      for (const type of ext.contentTypes ?? []) typeSchema.parse(type);
      for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
        if (
          !key.startsWith(ext.id + ':') ||
          blockTypes.includes(key) ||
          typeof renderer !== 'function'
        )
          throw new Error('扩展区块需要使用自己的前缀与渲染器：' + key);
        const definition = ext.blockDefinitions?.[key];
        if (
          definition &&
          (!definition.label ||
            !Array.isArray(definition.fields) ||
            typeof definition.schema?.safeParse !== 'function')
        )
          throw new Error('扩展区块声明无效：' + key);
      }
      for (const key of Object.keys(ext.blockDefinitions ?? {}))
        if (!ext.blocks?.[key]) throw new Error('区块声明缺少渲染器：' + key);
      for (const task of ext.schedules ?? [])
        if (
          !task.id ||
          !Number.isFinite(task.intervalMs) ||
          task.intervalMs < 1000 ||
          typeof task.run !== 'function'
        )
          throw new Error('扩展定时任务声明无效。');
      member.extension = ext;
    } catch (error: any) {
      member.error = error.message;
    }
  }
  return members;
}
export function orderExtensions(
  members: ExtensionMember[],
  configured: (member: ExtensionMember) => boolean,
  blocked: (member: ExtensionMember, error: Error) => void,
) {
  const selected = members.filter((member) => configured(member)),
    ordered: ExtensionMember[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (member: ExtensionMember) => {
    if (visited.has(member.id)) return;
    if (visiting.has(member.id))
      throw new WeavaError('扩展依赖形成循环：' + [...visiting, member.id].join(' → '));
    if (member.error || !member.extension)
      throw new WeavaError(member.id + ' 无法载入：' + member.error);
    visiting.add(member.id);
    for (const dependency of member.extension.dependencies ?? []) {
      const target = selected.find((item) => item.id === dependency.id);
      if (!target) throw new WeavaError(member.id + ' 需要启用扩展 ' + dependency.id);
      visit(target);
      if (
        dependency.minVersion &&
        compareVersion(target.extension!.version ?? '0.0.0', dependency.minVersion) < 0
      )
        throw new WeavaError(
          member.id + ' 需要 ' + dependency.id + ' ' + dependency.minVersion + ' 或更新版本',
        );
    }
    visiting.delete(member.id);
    visited.add(member.id);
    ordered.push(member);
  };
  for (const member of selected)
    try {
      visit(member);
    } catch (error: any) {
      visiting.clear();
      blocked(member, error);
    }
  return ordered;
}
