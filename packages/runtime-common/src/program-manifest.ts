import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_VERSION } from '../../contracts/src/index.ts';
import { WeavaError } from '../../contracts/src/errors.ts';
import { digest } from './identity.ts';
import { inside } from './paths.ts';
import { verifyProgramDependencies, type DependencySnapshot } from './program-dependencies.ts';

export interface ProgramManifest {
  version: 1;
  id: string;
  framework: string;
  apiVersion: number;
  schemaVersion: number;
  nodeMajor: number;
  platform?: string;
  upgradeProtocol?: number;
  createdAt: string;
  dependencies: string;
  dependencyPackages: { name: string; hash: string }[];
  dependencyFiles: DependencySnapshot['files'];
  dependencyLinks: DependencySnapshot['links'];
  files: { path: string; hash: string }[];
}

export const programEntries = [
  'runtime/weava.mjs',
  'runtime/worker.mjs',
  'runtime/check.mjs',
  'web/server/entry.mjs',
  'admin/index.html',
] as const;

/** Managed and legacy deployments share validation; only their required entry points differ. */
export function verifyProgram(input: string, options: { managed?: boolean } = {}) {
  const root = resolve(input),
    source = readFileSync(join(root, 'program.json'));
  const manifest = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, '')) as ProgramManifest;
  if (
    manifest.version !== 1 ||
    typeof manifest.id !== 'string' ||
    manifest.apiVersion !== API_VERSION ||
    !Number.isSafeInteger(manifest.schemaVersion) ||
    manifest.nodeMajor !== Number(process.versions.node.split('.')[0]) ||
    (manifest.platform && manifest.platform !== process.platform) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new WeavaError('程序清单、平台或 Node/API 版本不兼容。');
  const required = [...programEntries, ...(options.managed ? ['runtime/manager.mjs'] : [])];
  for (const entry of required)
    if (!manifest.files.some((file) => file.path === entry))
      throw new WeavaError('程序缺少入口：' + entry);
  for (const file of manifest.files) {
    if (
      !file.path ||
      !['admin/', 'web/', 'runtime/'].some((prefix) => file.path.startsWith(prefix))
    )
      throw new WeavaError('程序清单包含非程序文件。');
    const path = inside(root, file.path);
    if (!existsSync(path) || digest(readFileSync(path)) !== file.hash)
      throw new WeavaError('程序文件校验失败：' + file.path);
  }
  if (
    !Array.isArray(manifest.dependencyFiles) ||
    !manifest.dependencyFiles.length ||
    !Array.isArray(manifest.dependencyLinks)
  )
    throw new WeavaError('此旧程序版本尚未固定运行依赖，请重新构建并检查后再选择。');
  verifyProgramDependencies(root, {
    files: manifest.dependencyFiles,
    links: manifest.dependencyLinks,
  });
  return { root, manifest, manifestHash: digest(source) };
}
